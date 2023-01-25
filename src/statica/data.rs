use serde_json::{from_str, json, Map, Result as SerdeJsonResult, Value};

use gray_matter::engine::YAML;
use gray_matter::Matter;

use crate::statica::statica_t::{Data, FileMeta};
use crate::util::path;

use std::{fs::read_to_string, path::PathBuf};

fn get_file_meta<'m>(file: &'m PathBuf) -> Option<FileMeta<'m>> {
    if let Some(filename) = file.file_name() {
        let filename = filename.to_str().unwrap().to_string();

        let file_stem = file
            .file_stem()
            .unwrap_or_default()
            .to_str()
            .unwrap_or_default();

        let data_ext = format!(".data");

        let name = if file_stem.ends_with(&data_ext) {
            let mut name = file_stem.split(&data_ext);
            let name = name.next();
            name.unwrap()
        } else {
            file_stem
        };

        let raw = read_to_string(file).ok().unwrap_or_default();

        return Some(FileMeta {
            name,
            filename,
            raw,
        });
    }

    None
}

fn md_into_object(file: &PathBuf) -> Value {
    if let Some(meta) = get_file_meta(file) {
        let matter = Matter::<YAML>::new();
        let data = matter.parse(&meta.raw);
        let content_meta: Value = data.data.unwrap().deserialize().unwrap();
        let _html = markdown::to_html(&data.content);

        let value = json!({
            "meta": {
                "filename": meta.filename,
                "raw_content": null// meta.raw
            },
            "name": meta.name,
            "content": null,// html,
            "data": content_meta
        });

        return value;
    }

    json!({})
}

fn json_into_object(file: &PathBuf) -> Value {
    if let Some(meta) = get_file_meta(file) {
        let data: Value = from_str(&meta.raw).unwrap_or_default();

        let value = json!({
            "meta": {
                "filename": meta.filename,
                "raw_content": null //meta.raw
            },
            "name": meta.name,
            "content": Value::Null,
            "data": data
        });

        return value;
    }

    json!({})
}

// fn slugify(name: &str) -> String {
//     let result = String::from(name);
//     result
//         .replace(" ", "-")
//         .replace("/", "-")
//         .replace("\n", "-")
// }

// *** Interface ***

pub fn get_data() -> SerdeJsonResult<Data> {
    let data_files = path::read_data().ok().unwrap();

    let list = &mut vec![];
    let json = &mut Map::new();

    for file in data_files {
        // skip if file DNE
        if file.metadata().is_err() {
            continue;
        }

        let ext = file.extension().and_then(|s| s.to_str());

        match ext {
            Some("md") => {
                let content = md_into_object(&file);
                list.push(content);
            }
            Some("json") => {
                let content = json_into_object(&file);
                list.push(content);
            }
            _ => {}
        }
    }

    Ok(Data {
        for_each: list.to_owned(),
        for_query: json.to_owned(),
        length: list.len(),
    })
}
