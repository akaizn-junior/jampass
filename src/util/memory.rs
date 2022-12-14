use std::{collections::HashMap, path::PathBuf};

#[derive(Debug, Default, Clone)]
pub struct Memory {
    pub files: HashMap<String, File>,
    pub linked: HashMap<PathBuf, HashMap<PathBuf, PathBuf>>,
    pub component: Component,
    pub watch_mode: bool,
    pub edited_env: bool,
    pub edited_component: (bool, PathBuf),
}

#[derive(Debug, Default, Clone)]
pub struct Component {
    pub style: Vec<String>,
    pub script: Vec<String>,
}

#[derive(Debug, Default, Clone)]
pub struct File {
    pub checksum: u32,
    pub path: PathBuf,
}

impl Memory {
    pub fn clear(&mut self) {
        self.files.clear();
    }
}
