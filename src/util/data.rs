use serde_json::{from_str, json, to_string_pretty, Map, Result as SerdeJsonResult, Value};

use gray_matter::engine::YAML;
use gray_matter::Matter;

use crate::util::path;
use std::{fs::read_to_string, path::PathBuf};

pub struct Data {
    pub list: Vec<Value>,
    pub json: Map<String, Value>,
}

impl Data {
    pub fn list_to_string(&self) -> String {
        let mut res = String::new();
        res.push_str("[");

        for val in self.list.iter() {
            let formatted = format!("\n{}", to_string_pretty(val).ok().unwrap_or_default());
            res.push_str(&formatted);
        }

        res.push_str("]");
        return res;
    }
}

fn parse_md(file: &PathBuf) -> Value {
    if let Some(filename) = file.file_name() {
        let filename = filename.to_str().unwrap().to_string();
        let name = file.file_stem().unwrap().to_str().unwrap().to_string();

        let raw = read_to_string(&file).ok().unwrap_or_default();
        let matter = Matter::<YAML>::new();
        let data = matter.parse(&raw);
        let content_meta: Value = data.data.unwrap().deserialize().unwrap();

        let value = json!({
            "meta": {
                "filename": filename,
                "raw_content": raw
            },
            "name": name,
            "content": data.content,
            "data": content_meta
        });

        return value;
    }

    json!({})
}

fn parse_json(file: &PathBuf) -> Value {
    if let Some(filename) = file.file_name() {
        let filename = filename.to_str().unwrap().to_string();
        let name = file.file_stem().unwrap().to_str().unwrap().to_string();

        let raw = read_to_string(&file).ok().unwrap_or_default();
        let data: Value = from_str(&raw).unwrap_or_default();

        let value = json!({
            "meta": {
                "filename": filename,
                "raw_content": raw
            },
            "name": name,
            "content": Value::Null,
            "data": data
        });

        return value;
    }

    json!({})
}

/// Transforms a path into a JSON Object
fn transform_path_into_object(file: &PathBuf, content: Value) -> (String, Value) {
    let stripped = if path::is_data_dir(file) {
        path::strip_data_dir(&file)
    } else {
        path::strip_cwd(&file)
    };

    let parts = stripped.components();
    let key = &mut String::from("data");
    let init = &mut json!({});

    let object = parts.fold((key, init), |acc, part| {
        let part_path = PathBuf::from(part.as_os_str());
        let part_name = part_path.file_stem();

        if part_name == None {
            return acc;
        }

        let name = part_name.unwrap().to_str().unwrap();

        if part_path.extension().is_some() {
            let key = format!("/{}", acc.0);
            let val = acc.1.pointer_mut(&key);

            // if it has a parent object
            if let Some(o) = val {
                // finally insert the value
                *o = json!({
                    {name}: content
                });

                *acc.1 = o.to_owned();
            } else {
                *acc.0 = name.to_owned();
                *acc.1 = content.to_owned();
            }

            return acc;
        }

        if acc.0 == "data" {
            *acc.1 = json!({
                {name.to_owned()}: {}
            });

            // next key
            *acc.0 = name.to_owned();
            return acc;
        }

        // nested object
        *acc.1 = json!({
            {acc.0.to_owned()}: {
                {name.to_owned()}: {}
            }
        });

        // build next key
        *acc.0 = format!("{}/{}", acc.0, name);
        return acc;
    });

    (object.0.to_owned(), object.1.to_owned())
}

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
                let content = parse_md(&file);
                let obj = transform_path_into_object(&file, content);
                list.push(obj.1.to_owned());
                json.insert(obj.0, obj.1);
            }
            Some("json") => {
                let content = parse_json(&file);
                let obj = transform_path_into_object(&file, content);
                list.push(obj.1.to_owned());
                json.insert(obj.0, obj.1);
            }
            _ => {}
        }
    }

    Ok(Data {
        list: list.to_owned(),
        json: json.to_owned(),
    })
}
