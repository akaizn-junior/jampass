extern crate clap;
use clap::{Parser, Subcommand};

#[derive(Parser, Debug, Default)]
#[command(
  author = "Simao Nziaka",
  version,
  about = "Static web builder",
  long_about = None
)]
pub struct App {
    /// Work environment
    #[arg(short, long, default_value = "development")]
    env: String,

    /// User config path
    #[arg(short, long, default_value = "jampass.toml")]
    config: String,

    /// User src path
    #[arg(short, long, default_value = "src")]
    pub src: String,

    /// User cwd path
    #[arg(short = 'C', long, default_value = ".")]
    pub cwd: String,

    /// Toggle debug logs
    #[arg(short = 'D', long, default_value_t = false)]
    debug: bool,

    /// Output directory
    #[arg(short, long, default_value = "public")]
    pub dist: String,

    /// Output multiple entries in dist directory
    #[arg(short = 'M', long, default_value_t = false)]
    multi: bool,

    /// Data file path aka funnel
    #[arg(short = 'F', long, default_value = "jampass.data.js")]
    funnel: String,

    /// Views path
    #[arg(long, default_value = "views")]
    views: String,

    /// Re-generate pages on data changes
    #[arg(short = 'W', long, default_value_t = false)]
    datawatch: bool,

    #[command(subcommand)]
    pub action: Option<Action>,
}

#[derive(Subcommand, Debug)]
pub enum Action {
    /// Generates static assets
    Gen {},

    /// Starts development server
    Serve {
        /// Server port
        #[arg(short, long, default_value_t = 9999)]
        port: u16,

        /// Open default browser
        #[arg(short, long, default_value_t = false)]
        open: bool,

        /// Enable server directory listing
        #[arg(short, long, default_value_t = false)]
        list: bool,
    },

    /// Watch source edits
    Watch {},

    /// Lint source files
    Lint {
        /// Auto fix linting errors
        #[arg(short, long, default_value_t = false)]
        fix: bool,

        /// Eslint configuration file path
        #[arg(short, long, default_value = ".eslintrc")]
        esrc: String,
    },
}
