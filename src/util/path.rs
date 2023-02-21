use std::fs::read_dir;
use std::path::{Path, PathBuf};

use crate::core_t::Result;
use crate::env;

pub type PathList = Vec<PathBuf>;

#[derive(Debug)]
pub enum Strategy {
    Index,
    Src,
    Nil,
}

/// *** should implement an ignorerc file
const IGNORE: [&str; 3] = [".git", "node_modules", "public"];

// *** HELPERS ***

fn eval_path_strat(p: &str, strat: Strategy, f: fn() -> Strategy) -> Strategy {
    match canonical(p) {
        Ok(_) => strat,
        Err(_) => f(),
    }
}

fn strip(prefix: PathBuf, path: &PathBuf) -> Option<&Path> {
    let prefix_as_str = prefix.to_str().unwrap_or("");
    // get the file base, aka everything else but the prefix
    path.strip_prefix(prefix_as_str).ok()
}

// *** INTERFACE ***

/// Canonicalize a string path
pub fn canonical(p: &str) -> Result<PathBuf> {
    let path = PathBuf::from(p);
    let canonical_path = path.canonicalize()?;
    Ok(canonical_path)
}

/// Rules for path evaluation
pub fn is_valid_path(path: &PathBuf) -> bool {
    let filename = path.file_name().unwrap_or_default();
    let fnm_as_str = filename.to_str().unwrap_or("");

    // Ignore files/dirs starting with "." except ".env"
    let is_dot_file_not_env = filename.ne(".env") && fnm_as_str.starts_with(".");
    // Ignore specific files/dirs
    let is_ignored = IGNORE.contains(&fnm_as_str);
    // skip already processed files
    let is_processed = starts_with_owd(&path);
    // no data
    let is_data = is_data(&path);

    // eval rules
    if !is_dot_file_not_env && !is_ignored && !is_processed && !is_data {
        return true;
    }

    // everything else is a no go!
    return false;
}

/// Recursively reads paths from a directory
pub fn read_paths(root: PathBuf) -> Result<PathList> {
    let mut list = PathList::new();

    fn inner(root: &PathBuf, list: &mut PathList) {
        let entries = read_dir(root).unwrap();

        for entry in entries {
            if let Ok(de) = entry {
                let de_path = de.path();

                if !is_valid_path(&de_path) {
                    continue;
                }

                // Parse subdirectories
                if let Ok(filetype) = de.file_type() {
                    if filetype.is_dir() {
                        inner(&de_path, list);
                    } else {
                        list.push(de_path);
                    }
                }
            }
        }
    }

    inner(&root, &mut list);

    Ok(list)
}

/// Evaluates the current working directory for an appropriate work strategy
/// cwd must contain an "index.html", "index.htm" or a "src" entry point
pub fn evaluate_cwd() -> Strategy {
    /// denotes that no valid strategy was employed
    fn nil_strat() -> Strategy {
        Strategy::Nil
    }

    /// check if the cwd has a custom src directory
    fn src_strat() -> Strategy {
        let src_dir = env::src_dir();
        let src_str = src_dir.to_str().unwrap_or("src");
        eval_path_strat(src_str, Strategy::Src, nil_strat)
    }

    /// check if the cwd has an "index.htm" file
    fn htm_strat() -> Strategy {
        eval_path_strat("index.htm", Strategy::Index, src_strat)
    }

    /// check if the cwd has an "index.html" file
    fn html_strat() -> Strategy {
        eval_path_strat("index.html", Strategy::Index, htm_strat)
    }

    return html_strat();
}

/// Returns the path with the cwd substituted with the owd
pub fn prefix_with_owd(file: &PathBuf) -> PathBuf {
    let owd = env::output_dir();
    let file_base = strip_cwd_for_output(file);
    // setup the output path for this file
    let owd = owd.join(file_base);
    return owd;
}

/// Strips the cwd from the path
pub fn strip_cwd(file: &PathBuf) -> &Path {
    strip(env::current_dir(), file).unwrap_or(Path::new("."))
}

/// Strips the original CWD aka crate CWD from the path
pub fn strip_crate_cwd(file: &PathBuf) -> &Path {
    strip(env::crate_cwd(), file).unwrap_or(Path::new("."))
}

/// Strips the data dir from the path
pub fn strip_data_dir(file: &PathBuf) -> &Path {
    strip(env::data_dir(), file).unwrap_or(strip_cwd(file))
}

/// Strips the cwd or the known src path from the given path.
/// Used specifically for when generating paths for output
pub fn strip_cwd_for_output(file: &PathBuf) -> &Path {
    let src_path = env::src_dir();

    if file.starts_with(&src_path) {
        // strip the known src path
        return strip(env::src_dir(), file).unwrap_or(Path::new("."));
    }

    return strip_cwd(&file);
}

/// Verifies if the path starts with the OWD
pub fn starts_with_owd(file: &PathBuf) -> bool {
    let owd = env::output_dir();
    file.starts_with(owd)
}

/// Verifies if the path is a data file
pub fn is_data(file: &PathBuf) -> bool {
    let data = env::data_dir();
    let is_data_dir = file.starts_with(data);

    // check the last component of the path
    if let Some(part) = file.components().next_back() {
        // turn the last component of the path into a string
        let part = &part.as_os_str().to_str().unwrap_or_default();
        // get the extension
        let ext = file.extension().unwrap_or_default();
        // create the data extension
        let data_ext = format!(".data.{}", ext.to_string_lossy());
        // check
        return part.ends_with(&data_ext) || is_data_dir;
    }

    is_data_dir
}

// /// Evaluates template filename
// fn eval_template_name(file: &PathBuf) {
//     let filename = file.file_name();

//     if let Some(name) = filename {
//         let name = name.to_str().unwrap_or_default();
//         println!("name {:?}", name);
//     }
// }
