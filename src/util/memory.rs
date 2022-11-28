use std::collections::HashMap;

#[derive(Debug, Default)]
pub struct Memory {
    pub files: HashMap<u32, File>,
    pub templates: HashMap<String, HashMap<String, String>>,
    pub watch_mode: bool,
}

#[derive(Debug, Default)]
pub struct File {
    pub checksum: u32,
}

impl Memory {
    pub fn clear(&mut self) {
        self.files.clear();
    }
}
