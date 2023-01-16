// module
use crate::util;

// use
use dotenv::dotenv;
use std::env;
use std::path::PathBuf;

use crate::core_t::Result;

fn test_path_input(var_name: &str, opt: &str, default: &str) -> PathBuf {
    let default_path = PathBuf::from(default);
    // test env var path, fallback to default
    let env_var = env::var(var_name).unwrap_or_default();
    let env_path = util::path::canonical(&env_var).unwrap_or(default_path);
    // test cmd option path, fallback to env var path
    let opt_path = util::path::canonical(&opt).unwrap_or(env_path);
    return opt_path;
}

fn test_string_input(var_name: &str, opt: &str, default: &str) -> String {
    // check if the env var is set or fallback to default
    let env_var = env::var(var_name).unwrap_or(default.to_string());
    // check if the cmd opt is set and not the default
    let result = if !opt.is_empty() && opt.ne(default) {
        opt.to_string()
    } else {
        // the env var will either be a value set from an env var or the default value
        env_var
    };

    return result;
}

fn set_custom_cwd(root: &str) -> Result<()> {
    let tested = test_path_input("JAMPASS_CWD", root, ".");
    // update the cwd
    env::set_current_dir(tested)?;
    Ok(())
}

/// Load and evaluate local dot env file
pub fn eval_dotenv() {
    dotenv().ok();
}

/// Sets the current working directory
/// and parses the local .env file
pub fn config(root: &str) -> Result<()> {
    // capture the crate's CWD before changing it for the user
    env::set_var("JAMPASS_CRATE_CWD", current_dir());
    // first evaluate user provided root at the current cwd = "."
    let current = util::path::canonical(root).unwrap_or(PathBuf::from("."));
    // change the CWD to the user's project root
    // at this point only the cmd option is read
    // this value will be filled or empty, but its needed so that
    // a local .env file is evaluated at the right place
    let res = env::set_current_dir(current);

    if res.is_ok() {
        // load ad eval .env
        eval_dotenv();
        // at this point we may still need to re-eval the cwd path, if it was the default path previously
        // the .env file might have been set to a different cwd
        set_custom_cwd(root)?;
    }

    Ok(())
}

/// Resolves and returns the current working directory
pub fn current_dir() -> PathBuf {
    return env::current_dir().ok().unwrap_or(PathBuf::from("."));
}

/// Set the output working directory as "JAMPASS_OWD" env var
pub fn set_output_dir(dist: &str) {
    let tested = test_string_input("JAMPASS_OWD", dist, ".jampass");
    let p = current_dir().join(tested);
    env::set_var("JAMPASS_OWD", p);
}

/// Set the src directory as "JAMPASS_SRC" env var
pub fn set_src_dir(src: &str) {
    let tested = test_path_input("JAMPASS_SRC", src, "src");
    // now set the full src path as a dir inside the cwd
    let p = current_dir().join(tested);
    env::set_var("JAMPASS_SRC", p);
}

/// Set the data directory as "JAMPASS_DATA" env var
pub fn set_data_dir(dir: &str) {
    let tested = test_path_input("JAMPASS_DATA", dir, "data");
    // now set the full path as a dir inside the cwd
    let p = current_dir().join(tested);
    env::set_var("JAMPASS_DATA", p);
}

/// Get the current source directory
pub fn src_dir() -> PathBuf {
    let with_src = current_dir().join("src");
    let default = with_src.to_str().unwrap_or_default();
    let var = env::var("JAMPASS_SRC").unwrap_or(default.to_string());
    return PathBuf::from(var);
}

/// Get the data directory
pub fn data_dir() -> PathBuf {
    let with_data = current_dir().join("data");
    let default = with_data.to_str().unwrap_or_default();
    let var = env::var("JAMPASS_DATA").unwrap_or(default.to_string());
    return PathBuf::from(var);
}

/// Get the OWD. Output Working Directory as a PathBuf
pub fn output_dir() -> PathBuf {
    let cwd = current_dir().join("public");
    let default = cwd.to_str().unwrap_or_default();
    let var = env::var("JAMPASS_OWD").unwrap_or(default.to_string());
    return PathBuf::from(var);
}

/// Get the package cwd
pub fn crate_cwd() -> PathBuf {
    let var = env::var("JAMPASS_CRATE_CWD").unwrap_or(".".to_string());
    return PathBuf::from(var);
}

/// Returns the latest env var
pub fn latest() -> (String, String) {
    return env::vars()
        .last()
        .unwrap_or(("".to_string(), "".to_string()));
}
