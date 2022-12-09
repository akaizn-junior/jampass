// extern crates
extern crate dotenv;

// module
use crate::util;

// use
use dotenv::dotenv;
use std::env;
use std::path::PathBuf;

/// Evaluates local dot env file
pub fn eval_dotenv() {
    dotenv().ok();
}

/// Sets the current working directory
/// and parses the local .env file
pub fn config(root: &str) {
    // capture the package's active CWD
    env::set_var("PACKAGE_CWD", current_dir());
    let c = util::path::canonical(root).unwrap_or(PathBuf::from("."));
    // change the CWD to the user's project root
    let res = env::set_current_dir(c);

    if res.is_ok() {
        eval_dotenv()
    }
}

/// Resolves and returns the current working directory
pub fn current_dir() -> PathBuf {
    return env::current_dir().ok().unwrap_or(PathBuf::from("."));
}

/// Set the output working directory as "JAMPASS_OWD" env var
pub fn set_output_dir(dist: &str) {
    let cwd = current_dir();
    let owd = cwd.join(dist);
    env::set_var("JAMPASS_OWD", owd);
}

/// Returs the OWD. Output Working Directory as a PathBuf
pub fn output_dir() -> PathBuf {
    let cwd = current_dir();
    let default = cwd.join("public").to_string_lossy().to_string();
    let var = env::var("JAMPASS_OWD").unwrap_or(default);
    return PathBuf::from(var);
}

pub fn package_cwd() -> PathBuf {
    let var = env::var("PACKAGE_CWD").unwrap_or(".".to_string());
    return PathBuf::from(var);
}

/// Returns the latest env var
pub fn latest() -> (String, String) {
    return env::vars()
        .last()
        .unwrap_or(("".to_string(), "".to_string()));
}
