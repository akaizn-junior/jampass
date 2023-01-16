//! Jampass core API

use notify::event::{CreateKind, DataChange, EventKind::*, ModifyKind, RenameMode};
use notify::{Config, Event, RecursiveMode, Watcher};

use std::sync::mpsc::channel;
use std::time::Duration;

// modules
use crate::env;
use crate::util::{file, memory::Memory, path};

use crate::{
    core_t::{Emoji, Init, LintOpts, Opts, Result, ServeOpts},
    util::path::PathList,
};

// Helpers

/// Read file paths from the source folder
fn read_src_path(root: &str) -> Result<PathList> {
    let custom_src = path::canonical(root)?;
    let paths = path::recursive_read_paths(custom_src, false)?;
    Ok(paths)
}

fn eval_files_loop(files: &PathList, memo: &mut Memory) -> Result<()> {
    for pb in files {
        // skip components and other linked assets
        if file::is_linked_naive(&pb) {
            if memo.watch_mode && memo.edited_asset.path.eq(pb) {
                file::eval_linked_asset_edit(pb, memo)?;
            }
            continue;
        }

        if file::is_env_file(pb) {
            if !memo.watch_mode || (memo.watch_mode && memo.edited_env) {
                file::env(pb, memo)?;
            }
            memo.edited_env = false;
            continue;
        }

        let pb_ext = pb.extension().and_then(|s| s.to_str());

        match pb_ext {
            Some("html") => {
                file::html(pb, memo)?;
            }
            Some("htm") => {
                file::html(pb, memo)?;
            }
            _ => {}
        }
    }

    Ok(())
}

fn handle_watch_event(config: &Opts, event: Event, memo: &mut Memory) -> Result<()> {
    let Event {
        kind,
        paths,
        attrs: _,
    } = event;

    // filter out already processed files
    let ps: PathList = paths
        .into_iter()
        .filter(|p| path::is_valid_path(&p))
        .collect();

    match kind {
        Create(ce) => match ce {
            CreateKind::File => gen(&config, &ps, memo)?,
            _ => {}
        },
        Modify(me) => match me {
            ModifyKind::Data(e) => match e {
                DataChange::Any => {
                    if ps.iter().any(|p| file::is_env_file(p)) {
                        memo.edited_env = true;
                    }

                    let linked = ps.iter().find(|&p| file::is_linked_naive(&p));

                    if let Some(lnk) = linked {
                        memo.edited_asset.set(true, lnk.to_owned());
                    }

                    gen(&config, &ps, memo)?;
                }
                _ => {}
            },
            ModifyKind::Name(mode) => match mode {
                RenameMode::Both => {
                    if !ps.is_empty() {
                        let from = &ps[0];
                        let to = &ps[1];

                        if file::is_component(to) {
                            return file::handle_component_rename(from, to, memo);
                        }

                        // in other cases just the renaming is enough
                        file::rename_output(from, to)?;
                    }
                }
                _ => {}
            },
            _ => {}
        },
        Remove(_e) => file::remove(ps)?,
        _ => {}
    }

    Ok(())
}

// API

pub fn setup(init: Init) -> Result<()> {
    env::config(&init.cwd)?;
    env::set_output_dir(&init.owd);
    env::set_src_dir(&init.src);
    env::set_data_dir(&init.data);
    Ok(())
}

/// Generates static assets
pub fn gen(_config: &Opts, paths: &PathList, memo: &mut Memory) -> Result<()> {
    let strategy = path::evaluate_cwd();

    match strategy {
        path::Strategy::Index => {
            if !paths.is_empty() {
                eval_files_loop(paths, memo)?;
                return Ok(());
            }

            let src_paths = read_src_path(".")?;
            eval_files_loop(&src_paths, memo)?;
        }
        path::Strategy::Src => {
            let src_dir = env::src_dir();

            if !paths.is_empty() {
                let inside_src = paths
                    .to_vec()
                    .into_iter()
                    .filter(|p| p.starts_with(&src_dir))
                    .collect();

                eval_files_loop(&inside_src, memo)?;
                return Ok(());
            }

            let src_str = src_dir.to_str().unwrap_or(".");
            let src_paths = read_src_path(src_str)?;
            eval_files_loop(&src_paths, memo)?;
        }
        path::Strategy::Nil => {
            println!("{} Empty project!", Emoji::EMPTY);
        }
    }

    Ok(())
}

/// Watch source edits
pub fn watch(config: Opts) -> Result<()> {
    let cwd = env::current_dir();
    let owd = env::output_dir();

    let mut memo = Memory::default();
    memo.watch_mode = true;

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
        Ok(()) => {
            println!("{} Watching...\n", Emoji::WATCH);
            // start by generating files
            gen(&config, &PathList::default(), &mut memo)?;
        }
        Err(e) => println!(
            "Watch error {} {}, \"{}\"",
            Emoji::ERROR,
            e.to_string(),
            cwd.to_string_lossy()
        ),
    }

    loop {
        let event = rx.recv()?;

        // if owd does not exist when watching, generate it
        if owd.metadata().is_err() {
            memo.clear();
            gen(&config, &PathList::default(), &mut memo)?;
        }

        match event {
            Ok(event) => handle_watch_event(&config, event, &mut memo)?,
            Err(e) => println!("Watch error {} {}", Emoji::ERROR, e.to_string()),
        }
    }
}

/// Starts development server
pub fn serve(_config: ServeOpts) -> Result<()> {
    unimplemented!("serve output files with a dev server")
}

/// Lint source files
pub fn lint(_config: LintOpts) -> Result<()> {
    unimplemented!("lint user codebase")
}
