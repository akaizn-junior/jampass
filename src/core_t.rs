//! Jampass core API types

use crate::cli_t::App;

pub type Error = Box<dyn std::error::Error>;
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub struct Init {
    pub cwd: String,
    pub owd: String,
}

#[derive(Debug)]
pub struct Opts {
    pub opts: App,
}

#[derive(Debug)]
pub struct LintOpts {
    pub fix: bool,
    pub esrc: String,
    pub global: Opts,
}

#[derive(Debug)]
pub struct ServeOpts {
    pub open: bool,
    pub port: u16,
    pub list: bool,
    pub global: Opts,
}
