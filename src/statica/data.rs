use serde_json::{from_str, json, Result as SerdeJsonResult, Value};

use gray_matter::engine::YAML;
use gray_matter::Matter;

use crate::env;
use crate::statica::{
    statica_c::{NL, SP},
    statica_t::{Data, DataEntry, DataMap, FileMeta},
};

use crate::util::path;

use std::{
    fs::{read_dir, read_to_string},
    path::{Path, PathBuf},
};

fn get_data_file_name(file: &PathBuf) -> &str {
    let file_stem = file
        .file_stem()
        .unwrap_or_default()
        .to_str()
        .unwrap_or_default();

    let data_ext = format!(".data");
    if file_stem.ends_with(&data_ext) {
        let mut name = file_stem.split(&data_ext);
        let name = name.next();
        return name.unwrap_or_default();
    }

    file_stem
}

fn get_file_meta<'m>(file: &'m PathBuf) -> Option<FileMeta<'m>> {
    if let Some(filename) = file.file_name() {
        let filename = filename.to_str().unwrap().to_string();

        let raw = read_to_string(file).ok().unwrap_or_default();
        let name = get_data_file_name(&file);

        return Some(FileMeta {
            name,
            filename,
            raw,
        });
    }

    None
}

fn slugify(name: &str) -> String {
    String::from(name)
        .replace(SP, "-")
        .replace("/", "-")
        .replace(NL, "-")
}

fn get_json_value(meta: FileMeta, content: String, data: Value) -> Value {
    json!({
        "meta": {
            "filename": meta.filename,
            "raw_content": meta.raw
        },
        "name": meta.name,
        "slug": slugify(meta.name),
        "content": content,
        "data": data
    })
}

fn md_into_object(file: &PathBuf) -> Value {
    if let Some(meta) = get_file_meta(file) {
        let matter = Matter::<YAML>::new();
        let data = matter.parse(&meta.raw);
        let content_matter: Value = data.data.unwrap().deserialize().unwrap();
        let html = markdown::to_html(&data.content);

        return get_json_value(meta, html, content_matter);
    }

    json!({})
}

fn json_into_object(file: &PathBuf) -> Value {
    if let Some(meta) = get_file_meta(file) {
        let data: Value = from_str(&meta.raw).unwrap_or_default();
        return get_json_value(meta, "".to_string(), data);
    }

    json!({})
}

fn get_data_as_object(file: &PathBuf) -> Value {
    // skip if file DNE
    if file.metadata().is_err() {
        return json!({});
    }

    let ext = file.extension().and_then(|s| s.to_str());
    match ext {
        Some("md") => md_into_object(&file),
        Some("json") => json_into_object(&file),
        _ => json!({}),
    }
}

/// Reads funneled data
fn read_data() -> DataMap {
    let root = env::current_dir();

    fn inner(root: &PathBuf, data: &mut DataMap) -> DataMap {
        let dir_entry = read_dir(root).unwrap();

        for entry in dir_entry {
            if let Ok(de) = entry {
                let de_path = de.path();

                if !path::is_data(&de_path) {
                    continue;
                }

                fn get_key(p: &PathBuf) -> String {
                    let data_item_path = path::strip_data_dir(&p).to_path_buf();
                    let key = data_item_path.to_str().unwrap_or_default();
                    key.split("/").last().unwrap_or_default().to_string()
                }

                // Parse subdirectories
                if let Ok(filetype) = de.file_type() {
                    if filetype.is_dir() {
                        let mut result = inner(&de_path, data);

                        let parent = de_path.parent().unwrap_or(Path::new(".")).to_path_buf();
                        let pkey = get_key(&parent);
                        let key = get_key(&de_path);

                        let def = &mut vec![];
                        let r_list = result.get_mut(&key).unwrap_or(def);

                        // get the parent list and append chidlren data to it
                        if let Some(list) = data.get_mut(&pkey) {
                            // only append children data if it does not already exist
                            for item in r_list {
                                if !list.contains(item) {
                                    list.push(item.to_owned())
                                }
                            }
                        } else {
                            // if parent list does not exis, create it
                            data.insert(pkey, r_list.to_owned());
                        }
                    } else {
                        let data_as_object = get_data_as_object(&de_path);
                        let data_item_path = path::strip_data_dir(&de_path).to_path_buf();

                        let parent = de_path.parent().unwrap_or(Path::new(".")).to_path_buf();
                        let key = get_key(&parent);

                        let data_name = get_data_file_name(&data_item_path);
                        let value =
                            DataEntry::new(data_name, data_item_path.to_owned(), data_as_object);

                        if let Some(list) = data.get_mut(&key) {
                            list.push(value);
                        } else {
                            data.insert(key.to_string(), vec![value]);
                        }
                    }
                }
            }
        }

        return data.to_owned();
    }

    inner(&root, &mut DataMap::new())
}

// *** Interface ***

pub fn get_data() -> SerdeJsonResult<Data> {
    let data = read_data();

    Ok(Data {
        values: data.to_owned(),
        length: data.values().len(),
    })
}
