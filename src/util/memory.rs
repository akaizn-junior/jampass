use std::{collections::HashMap, path::PathBuf};

#[derive(Debug, Default)]
pub struct Memory {
    pub files: HashMap<String, File>,
    pub linked: HashMap<String, Vec<u32>>,
    pub component: Component,
    pub watch_mode: bool,
    pub edited_env: bool,
}

#[derive(Debug, Default)]
pub struct Component {
    pub style: Vec<String>,
    pub script: Vec<String>,
}

#[derive(Debug, Default)]
pub struct File {
    pub checksum: u32,
    pub path: PathBuf,
}

impl Memory {
    pub fn clear(&mut self) {
        self.files.clear();
    }
}
