// modules
mod cli;
mod cli_t;
mod core;
mod core_t;
mod env;
mod statica;
mod test;
mod util;

fn handle_error(e: core_t::Error) {
    println!("{} {:?}", core_t::Emoji::ERROR, e);
}

fn main() {
    let result = cli::parse();

    match result {
        Err(e) => handle_error(e),
        _ => {}
    }
}
