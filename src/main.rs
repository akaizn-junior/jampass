// modules
mod cli;
mod cli_t;
mod core;
mod core_t;
mod env;
mod util;

fn massage_errors(e: core_t::Error) {
    println!("- {:?}", e);
}

fn main() {
    let result = cli::parse();

    match result {
        Err(e) => massage_errors(e),
        _ => {}
    }
}
