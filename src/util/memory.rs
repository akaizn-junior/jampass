use std::{collections::HashMap, path::PathBuf};

#[derive(Debug, Default, Clone)]
pub struct Memory {
    pub files: HashMap<String, File>,
    pub linked: HashMap<PathBuf, HashMap<PathBuf, PathBuf>>,
    pub component: Component,
    pub watch_mode: bool,
    pub edited_env: bool,
    pub edited_asset: EditedAsset,
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

#[derive(Debug, Default, Clone)]
pub struct EditedAsset {
    pub was_edited: bool,
    pub path: PathBuf,
    /// The original filename for when the filename is edited
    pub original_path: Option<PathBuf>,
}

impl Memory {
    pub fn clear(&mut self) {
        self.files.clear();
        self.edited_asset.reset();
    }
}

impl EditedAsset {
    pub fn set(&mut self, was_edited: bool, path: PathBuf) {
        self.was_edited = was_edited;
        self.path = path;
    }

    pub fn set_original_path(&mut self, original_path: Option<PathBuf>) {
        self.original_path = original_path;
    }

    pub fn reset(&mut self) {
        self.was_edited = false;
        self.path = PathBuf::new();
        // original_path remains for future checks
    }
}
