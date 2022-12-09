//! Jampass core API

extern crate notify;

use notify::event::{CreateKind, DataChange, EventKind::*, ModifyKind, RenameMode};
use notify::{Config, Event, RecursiveMode, Watcher};

use std::ffi::OsStr;
use std::sync::mpsc::channel;
use std::time::Duration;

// modules
use crate::env;
use crate::util::{file, memory::Memory, path};
use crate::{
    core_t::{Init, LintOpts, Opts, Result, ServeOpts},
    util::path::PathList,
};

// Helpers

/// Read file paths from the source folder
fn read_src_path(config: &Opts, root: &str) -> Result<PathList> {
    let custom_src = path::canonical(root)?;
    let paths = path::recursive_read_paths(config, custom_src)?;
    Ok(paths)
}

fn eval_files_loop(config: &Opts, files: &PathList, memo: &mut Memory) -> Result<()> {
    for pb in files {
        // eval .env file with no extension
        // env files should have .env extension or be named ".env"
        if pb.file_name() == Some(OsStr::new(".env")) {
            file::env(config, pb, memo)?;
        }

        if file::is_component(&pb)? {
            continue;
        }

        let pb_ext = pb.extension().and_then(|s| s.to_str());

        match pb_ext {
            Some("html") => {
                file::html(config, pb, memo)?;
            }
            Some("htm") => {
                file::html(config, pb, memo)?;
            }
            Some("env") => {
                file::env(config, pb, memo)?;
            }
            None => {}
            _ => {}
        }
    }

    Ok(())
}

fn handle_watch_event(config: &Opts, event: Event, memo: &mut Memory) -> Result<()> {
    let Event { kind, paths, attrs } = event;

    println!("{:?}", attrs);

    match kind {
        Create(ce) => match ce {
            CreateKind::File => gen(&config, paths, memo)?,
            _ => {}
        },
        Modify(me) => match me {
            ModifyKind::Data(e) => match e {
                DataChange::Any => gen(&config, PathList::default(), memo)?,
                DataChange::Content => gen(&config, PathList::default(), memo)?,
                _ => {}
            },
            ModifyKind::Name(mode) => match mode {
                RenameMode::Both => {
                    if !paths.is_empty() {
                        file::rename_output(&paths[0], &paths[1])?;
                    }
                }
                _ => {}
            },
            _ => {}
        },
        Access(_e) => {}
        Remove(_e) => file::remove(paths)?,
        Other => {}
        Any => {}
    }

    Ok(())
}

// API

pub fn setup(init: Init) {
    env::config(&init.cwd);
    env::set_output_dir(&init.owd);
}

/// Generates static assets
pub fn gen(config: &Opts, paths: PathList, memo: &mut Memory) -> Result<()> {
    let strategy = path::evaluate_cwd();

    match strategy {
        path::Strategy::Index => {
            if !paths.is_empty() {
                eval_files_loop(config, &paths, memo)?;
                return Ok(());
            }

            let src_paths = read_src_path(config, ".")?;
            eval_files_loop(config, &src_paths, memo)?;
        }
        path::Strategy::Src => {
            let cwd = env::current_dir();
            let with_cwd = cwd.join(&config.opts.src);

            if !paths.is_empty() {
                let inside_src = paths
                    .into_iter()
                    .filter(|p| p.starts_with(&with_cwd))
                    .collect::<PathList>();

                eval_files_loop(config, &inside_src, memo)?;
                return Ok(());
            }

            let with_cwd_str = with_cwd.to_str().expect("Valid string");
            let src_paths = read_src_path(config, with_cwd_str)?;
            eval_files_loop(config, &src_paths, memo)?;
        }
        path::Strategy::Nil => {
            println!("Empty project!");
        }
    }

    Ok(())
}

/// Watch source edits
pub fn watch(config: Opts) -> Result<()> {
    let cwd = env::current_dir();
    let owd = env::output_dir();

    let watcher_config = Config::default()
        .with_poll_interval(Duration::from_secs(5))
        .with_compare_contents(true);

    // Create a channel to receive the events
    // tx = transmitter; rx = receiver
    let (tx, rx) = channel();
    // Automatically select the best implementation for your platform
    let notify_watcher = notify::recommended_watcher(tx);

    // Expect a valid watcher
    let mut watcher = notify_watcher.expect("Recommended watcher");
    watcher.configure(watcher_config)?;

    // Evaluate watcher in recursive mode
    let recursive_watcher = watcher.watch(&cwd, RecursiveMode::Recursive);

    match recursive_watcher {
        Err(e) => println!(
            "Watch error: {}, \"{}\"",
            e.to_string(),
            cwd.to_string_lossy()
        ),
        _ => {}
    }

    let mut memo = Memory::default();
    memo.watch_mode = true;

    gen(&config, PathList::default(), &mut memo)?;

    loop {
        let event = rx.recv()?;

        // if owd does not exist when watch is called, generate it
        if owd.metadata().is_err() {
            memo.clear();
            gen(&config, PathList::default(), &mut memo)?;
        }

        match event {
            Ok(event) => handle_watch_event(&config, event, &mut memo)?,
            Err(e) => println!("Watch error {}", e.to_string()),
        }
    }
}

/// Starts development server
pub fn serve(_config: ServeOpts) -> Result<()> {
    unimplemented!()
}

/// Lint source files
pub fn lint(_config: LintOpts) -> Result<()> {
    unimplemented!()
}
