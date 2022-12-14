extern crate clap;
use clap::Parser;

// internal crates
use crate::cli_t::{Action, App};
use crate::core;
use crate::core_t::{Init, LintOpts, Opts, Result, ServeOpts};
use crate::util::{memory::Memory, path::PathList};

/// Parse command line arguments and subcommands
pub fn parse() -> Result<()> {
    let app = App::parse();
    let custom_cwd = &app.cwd.clone();
    let custom_owd = &app.dist.clone();

    core::setup(Init {
        cwd: custom_cwd.to_string(),
        owd: custom_owd.to_string(),
    });

    let mut memo = Memory::default();

    match &app.action {
        Some(Action::Gen {}) => {
            core::gen(&Opts { opts: app }, &PathList::default(), &mut memo)?;
        }
        Some(Action::Watch {}) => {
            core::watch(Opts { opts: app })?;
        }
        Some(Action::Lint { fix, esrc }) => {
            core::lint(LintOpts {
                fix: *fix,
                esrc: esrc.to_string(),
                global: Opts { opts: app },
            })?;
        }
        Some(Action::Serve { port, open, list }) => {
            core::serve(ServeOpts {
                port: *port,
                open: *open,
                list: *list,
                global: Opts { opts: app },
            })?;
        }
        None => {
            core::gen(&Opts { opts: app }, &PathList::default(), &mut memo)?;
        }
    }

    Ok(())
}
