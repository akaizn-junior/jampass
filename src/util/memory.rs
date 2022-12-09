use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct Memory {
    pub files: HashMap<u32, File>,
    pub linked: HashMap<String, Vec<u32>>,
    pub components: Components,
    pub watch_mode: bool,
}

#[derive(Debug, Default)]
pub struct Components {
    pub style: HashMap<String, String>,
    pub script: HashMap<String, String>,
}

#[derive(Debug, Default)]
pub struct File {
    pub checksum: u32
}

impl Memory {
    pub fn clear(&mut self) {
        self.files.clear();
    }
}
