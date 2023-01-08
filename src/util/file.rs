use adler::adler32_slice;

use std::{
    collections::HashMap,
    ffi::OsStr,
    fs::{copy, create_dir_all, read_to_string, remove_file, rename, write},
    path::{Path, PathBuf},
};

use crate::{
    core_t::{Emoji, Result},
    env,
    util::memory::{File, Memory},
    util::path,
    util::statica,
};

/// Content checksum Type
struct Checksum {
    as_u32: u32,
}

/// Indicates methods to output data
enum OutputAction<'a> {
    Write(&'a String),
    Copy(&'a PathBuf),
}

// **** CONSTANTS

const TEMPLATE_TAG_TOKEN: &str = "<template";

// **** end CONSTANTS

pub fn read_code(file: &PathBuf) -> Result<String> {
    let content = read_to_string(file)?;
    Ok(content)
}

fn write_file(owd: &PathBuf, contents: &String) -> Result<()> {
    write(owd, contents)?;
    Ok(())
}

fn copy_file(from: &PathBuf, to: &PathBuf) -> Result<()> {
    // copy returns the total number of bytes copied
    copy(from, to)?;
    Ok(())
}

/// Capture files that link to asset path
fn capture_linked_asset(file: &PathBuf, asset_path: &PathBuf, memo: &mut Memory) {
    let entry = memo.linked.entry(asset_path.to_owned()).or_default();
    entry.insert(file.to_owned(), file.to_owned());
}

/// Recursively create the full output path then write to it
fn recursive_output(file: &PathBuf, action: OutputAction) -> Result<()> {
    fn get_valid_owd(p: &PathBuf) -> Result<PathBuf> {
        let owd = path::prefix_with_owd(&p);
        // if file does not exist
        // create and write to it
        if owd.metadata().is_err() {
            let parent = owd.parent().unwrap_or(Path::new("."));

            if parent.metadata().is_err() {
                create_dir_all(parent)?;
            }
        }

        Ok(owd)
    }

    match action {
        OutputAction::Write(content) => {
            write_file(&get_valid_owd(file)?, content)?;
        }
        OutputAction::Copy(to) => {
            // make sure the file being copied exists
            if file.metadata().is_ok() {
                copy_file(&file, &get_valid_owd(to)?)?;
            }
        }
    }

    Ok(())
}

/// Generates a checksum as an Hex string from a string slice
fn checksum(slice: &str) -> Checksum {
    let as_u32 = adler32_slice(slice.as_bytes());
    // let as_hex = format!("{:x}", as_u32);

    return Checksum { as_u32 };
}

fn process_html(file: &PathBuf, code: &String, memo: &mut Memory) -> Result<()> {
    println!("File {} {:?}", Emoji::FILE, path::strip_crate_cwd(file));

    let parsed = statica::parse_code(&code, file)?;

    for lnk in parsed.linked_list {
        // if the asset does not exists, skip it
        if lnk.asset.metadata().is_err() {
            continue;
        }

        capture_linked_asset(&lnk.file, &lnk.asset, memo);

        // if the asset is not a component copy it
        if !lnk.is_component{
            recursive_output(&lnk.asset, OutputAction::Copy(&lnk.asset))?;
        }
    }

    recursive_output(&file, OutputAction::Write(&parsed.code))?;
    Ok(())
}

// Interface

pub fn handle_component_rename(from: &PathBuf, to: &PathBuf, memo: &mut Memory) -> Result<()> {
    // capture the path of the component being edited
    memo.edited_asset.set(true, to.to_owned());

    // if the filename of a component is edited, capture the original name
    if memo.edited_asset.original_path.is_none() {
        memo.edited_asset.set_original_path(Some(from.to_owned()));
    }

    // get the original_path for cases where a component's name is changed back
    // to its original name, that is certainly have been already evaluated as a linked asset
    if memo.edited_asset.original_path.is_some() {
        let original_path = memo.edited_asset.original_path.as_ref().unwrap();
        // check if the new name matches the known original path
        // evaluate it, otherwise the newly renamed file, is just a new asset
        if to.eq(original_path) {
            return eval_linked_asset_edit(to, memo);
        }
    }

    return eval_linked_asset_edit(from, memo);
}

pub fn eval_linked_asset_edit(pb: &PathBuf, memo: &mut Memory) -> Result<()> {
    let default = HashMap::default();
    let paths = memo.linked.get(pb).unwrap_or(&default);

    for p in paths.to_owned() {
        // the path here may still be a component because of nested components, so evaluate it
        let f = p.0;
        // if this files exists in linked
        if memo.linked.contains_key(&f) {
            eval_linked_asset_edit(&f, memo)?;
        }

        html(&f, memo)?;
    }

    // done
    memo.edited_asset.reset();
    Ok(())
}

/// Verifies if the code starts with a template tag
pub fn is_component(file: &PathBuf) -> bool {
    let code = read_code(file);

    if let Ok(code) = code {
        return code.trim_start().starts_with(TEMPLATE_TAG_TOKEN);
    }

    false
}

/// Naively checks for file extension to decide if a file is linked
/// proper checks happen latter
pub fn is_linked_naive(file: &PathBuf) -> bool {
    let ext = file.extension().and_then(|s| s.to_str());
    match ext {
        Some("js") => true,
        Some("css") => true,
        _ => is_component(file),
    }
}

pub fn html(file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let code = read_code(&file)?;
    let checksum = checksum(&code);
    // skip components
    let is_component = is_component(&file);

    // ignore empty code and components
    if is_component || code.is_empty() {
        return Ok(());
    }

    let file_as_str = file.to_str().unwrap();
    let processed = memo.files.entry(file_as_str.to_string()).or_default();
    let has_processed = processed.checksum.eq(&checksum.as_u32);

    // verify if the path has already been evaluated
    // or if the output does not exist
    if !has_processed || memo.edited_asset.was_edited {
        memo.files.insert(
            file_as_str.to_string(),
            File {
                checksum: checksum.as_u32,
                path: file.to_owned(),
            },
        );

        process_html(file, &code, memo)?;
    }

    Ok(())
}

/// env files should have .env extension or be named ".env"
pub fn is_env_file(file: &PathBuf) -> bool {
    file.file_name() == Some(OsStr::new(".env")) || file.extension() == Some(OsStr::new("env"))
}

pub fn env(_file: &PathBuf, memo: &mut Memory) -> Result<()> {
    // reload env vars at this point
    env::eval_dotenv();

    if memo.watch_mode {
        let latest = env::latest();

        // TODO: properly evaluate last edited env var, not just last added
        // TODO: check if dotenv throws an event from edited var
        println!("Added env var {} \"{}\"", Emoji::TREE, latest.0);
    }

    Ok(())
}

pub fn remove(paths: Vec<PathBuf>) -> Result<()> {
    for p in paths {
        let owd_path = path::prefix_with_owd(&p);
        // remove only if path exists
        if owd_path.metadata().is_ok() {
            remove_file(owd_path)?
        }
    }

    Ok(())
}

pub fn rename_output(from: &PathBuf, to: &PathBuf) -> Result<()> {
    let ffrom = path::prefix_with_owd(from);
    let tto = path::prefix_with_owd(to);

    // if file exists
    if ffrom.metadata().is_ok() {
        // check if the newly renamed file is a component, skip it
        let is_component = is_component(&tto);

        if !is_component {
            rename(ffrom, tto)?
        }
    }

    Ok(())
}
