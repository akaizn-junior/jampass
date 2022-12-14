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

/// Canonicalize a string path
pub fn canonical(p: &str) -> Result<PathBuf> {
    let path = PathBuf::from(p);
    let canonical_path = path.canonicalize()?;
    Ok(canonical_path)
}

/// Recursively reads paths from a directory
pub fn recursive_read_paths(root: PathBuf) -> Result<PathList> {
    let mut list = PathList::new();

    fn inner(root: &PathBuf, list: &mut PathList) {
        let owd = env::output_dir();
        let dir_entries = read_dir(root).unwrap();

        dir_entries.for_each(|res| {
            let de = res.unwrap();
            // **** should implement a ignore rc file
            const IGNORE: [&str; 3] = [".git", "node_modules", "public"];

            let filename = de.file_name();
            let filetype = de.file_type().unwrap();
            let fnm_str = filename.to_str().unwrap_or("");
            let de_path = de.path();

            // Ignore files/dirs starting with "." except ".env"
            if fnm_str.ne(".env") && fnm_str.starts_with(".") {
                return;
            }

            // Ignore specific files/dirs
            if IGNORE.contains(&fnm_str) {
                return;
            }

            // Ignore processed files
            if de_path.starts_with(&owd) {
                return;
            }

            // Parse subdirectories
            if filetype.is_dir() {
                return inner(&de_path, list);
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

    /// check if the cwd has an "src" directory
    fn src_strat() -> Strategy {
        eval_path_strat("src", Strategy::Src, nil_strat)
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
    let file_base = strip_cwd(file);
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
