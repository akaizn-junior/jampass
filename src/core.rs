//! Jampass core API

use notify::event::{CreateKind, DataChange, EventKind::*, ModifyKind, RenameMode};
use notify::{Config, Event, RecursiveMode, Watcher};

use std::{collections::HashMap, sync::mpsc::channel};
use std::{path::PathBuf, time::Duration};

// modules
use crate::env;
use crate::util::{file, memory::Memory, path};
use crate::{
    core_t::{Init, LintOpts, Opts, Result, ServeOpts},
    util::path::PathList,
};

// Helpers

/// Read file paths from the source folder
fn read_src_path(root: &str) -> Result<PathList> {
    let custom_src = path::canonical(root)?;
    let paths = path::recursive_read_paths(custom_src)?;
    Ok(paths)
}

fn eval_linked_component_edit(config: &Opts, pb: &PathBuf, memo: &mut Memory) -> Result<()> {
    let _default = HashMap::default();
    let paths = memo.linked.get(pb).unwrap_or(&_default);

    for p in paths.to_owned() {
        // the path here may still be a component because of nested components, so evaluate it
        let f = p.0;
        // if this files exists in linked
        if memo.linked.contains_key(&f) {
            eval_linked_component_edit(config, &f, memo)?;
        } else {
            file::html(config, &f, memo)?;
        }
    }

    Ok(())
}

fn eval_files_loop(config: &Opts, files: &PathList, memo: &mut Memory) -> Result<()> {
    for pb in files {
        // skip components
        if file::is_component(&pb) {
            if memo.watch_mode && memo.edited_component.1.eq(pb) {
                eval_linked_component_edit(config, pb, memo)?;
                // done
                memo.edited_component = (false, PathBuf::new());
            }

            continue;
        }

        if file::is_env_file(pb) {
            if !memo.watch_mode || (memo.watch_mode && memo.edited_env) {
                file::env(config, pb, memo)?;
            }

            memo.edited_env = false;
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

                    let component = ps.iter().find(|&p| file::is_component(&p));
                    if component.is_some() {
                        memo.edited_component = (true, component.unwrap().to_owned());
                    }

                    gen(&config, &ps, memo)?
                }
                _ => {}
            },
            ModifyKind::Name(mode) => match mode {
                RenameMode::Both => {
                    if !ps.is_empty() {
                        file::rename_output(&ps[0], &ps[1])?;
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

pub fn setup(init: Init) {
    env::config(&init.cwd);
    env::set_output_dir(&init.owd);
}

/// Generates static assets
pub fn gen(config: &Opts, paths: &PathList, memo: &mut Memory) -> Result<()> {
    let strategy = path::evaluate_cwd();

    match strategy {
        path::Strategy::Index => {
            if !paths.is_empty() {
                eval_files_loop(config, paths, memo)?;
                return Ok(());
            }

            let src_paths = read_src_path(".")?;
            eval_files_loop(config, &src_paths, memo)?;
        }
        path::Strategy::Src => {
            let cwd = env::current_dir();
            let with_cwd = cwd.join(&config.opts.src);

            if !paths.is_empty() {
                let inside_src = paths
                    .to_vec()
                    .into_iter()
                    .filter(|p| p.starts_with(&with_cwd))
                    .collect::<PathList>();

                eval_files_loop(config, &inside_src, memo)?;
                return Ok(());
            }

            let with_cwd_str = with_cwd.to_str().unwrap_or(".");
            let src_paths = read_src_path(with_cwd_str)?;
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
            // start by generating files
            gen(&config, &PathList::default(), &mut memo)?;
        }
        Err(e) => println!(
            "Watch error: {}, \"{}\"",
            e.to_string(),
            cwd.to_string_lossy()
        ),
    }

    loop {
        let event = rx.recv()?;

        // if owd does not exist when watch is called, generate it
        if owd.metadata().is_err() {
            memo.clear();
            gen(&config, &PathList::default(), &mut memo)?;
        }

        match event {
            Ok(event) => handle_watch_event(&config, event, &mut memo)?,
            Err(e) => println!("Watch error {}", e.to_string()),
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
