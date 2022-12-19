use std::fs::read_dir;

use std::path::{Path, PathBuf};

use crate::core_t::Result;
use crate::env;
use crate::util::path;

pub type PathList = Vec<PathBuf>;

#[derive(Debug)]
pub enum Strategy {
    Index,
    Src,
    Nil,
}

/// **** should implement a ignore rc file
const IGNORE: [&str; 3] = [".git", "node_modules", "public"];

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
    let is_processed = path::starts_with_owd(&path);

    // eval rules
    if !is_dot_file_not_env && !is_ignored && !is_processed {
        return true;
    }

    // everything else is a no go!
    return false;
}

/// Recursively reads paths from a directory
pub fn recursive_read_paths(root: PathBuf) -> Result<PathList> {
    let mut list = PathList::new();

    fn inner(root: &PathBuf, list: &mut PathList) {
        let dir_entries = read_dir(root).unwrap();

        dir_entries.for_each(|res| {
            let de = res.unwrap();
            let de_path = de.path();

            if !is_valid_path(&de_path) {
                return;
            }

            // Parse subdirectories
            if de.file_type().is_ok() {
                let filetype = de.file_type().unwrap();
                if filetype.is_dir() {
                    return inner(&de_path, list);
                }
            }

            list.push(de_path);
        });
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

fn eval_path_strat(p: &str, strat: Strategy, f: fn() -> Strategy) -> Strategy {
    match canonical(p) {
        Ok(_) => strat,
        Err(_) => f(),
    }
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
pub fn strip_cwd(file: &PathBuf) -> PathBuf {
    let cwd = env::current_dir();
    let cwd_as_str = cwd.to_str().unwrap_or("");
    // get the file base, aka everything else but the cwd
    let file_base = file.strip_prefix(cwd_as_str).unwrap_or(Path::new("."));
    return file_base.to_path_buf();
}

/// Strips the cwd or the known src path from the given path.
/// Used specifically for when generating paths for output
pub fn strip_cwd_for_output(file: &PathBuf) -> PathBuf {
    let src_path = env::src_dir();

    if file.starts_with(&src_path) {
        // strip the known src path
        let path_as_str = src_path.to_str().unwrap_or("");
        let file_base = file.strip_prefix(path_as_str).unwrap_or(Path::new("."));
        return file_base.to_path_buf();
    }

    return strip_cwd(file);
}

pub fn starts_with_owd(file: &PathBuf) -> bool {
    let owd = env::output_dir();
    file.starts_with(owd)
}
