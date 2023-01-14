//! Jampass core API types

use crate::cli_t::App;

pub type Error = Box<dyn std::error::Error>;
pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub struct Init {
    pub cwd: String,
    pub owd: String,
    pub src: String,
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

pub struct Emoji {}

impl Emoji {
    pub const EMPTY: &'static str = "🪹";
    pub const LINK: &'static str = "🖇 ";
    pub const TREE: &'static str = "🌳";
    pub const FILE: &'static str = "📃";
    // pub const COMPONENT: &'static str = "🪆";
    pub const FLAG: &'static str = "🚩";
    pub const ERROR: &'static str = "💣";
    pub const WATCH: &'static str = "🔭";
}
