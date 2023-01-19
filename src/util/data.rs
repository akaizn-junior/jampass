use serde_json::{from_str, json, to_string_pretty, Map, Result as SerdeJsonResult, Value};

use gray_matter::engine::YAML;
use gray_matter::Matter;

use crate::util::path;
use std::{fs::read_to_string, path::PathBuf};

pub struct Data {
    pub for_each: Vec<Value>,
    pub for_query: Map<String, Value>,
}

impl Data {
    pub fn list_to_string(&self) -> String {
        let mut res = String::new();
        res.push_str("[");

        for val in self.for_each.iter() {
            let formatted = format!("\n{}", to_string_pretty(val).ok().unwrap_or_default());
            res.push_str(&formatted);
        }

        res.push_str("]");
        return res;
    }
}

struct Meta<'m> {
    name: &'m str,
    filename: String,
    raw: String,
}

fn parse_helper<'m>(file: &'m PathBuf) -> Option<Meta<'m>> {
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

        return Some(Meta {
            name,
            filename,
            raw,
        });
    }

    None
}

fn parse_md(file: &PathBuf) -> Value {
    if let Some(meta) = parse_helper(file) {
        let matter = Matter::<YAML>::new();
        let data = matter.parse(&meta.raw);
        let content_meta: Value = data.data.unwrap().deserialize().unwrap();

        let value = json!({
            "meta": {
                "filename": meta.filename,
                "raw_content": meta.raw
            },
            "name": meta.name,
            "content": data.content,
            "data": content_meta
        });

        return value;
    }

    json!({})
}

fn parse_json(file: &PathBuf) -> Value {
    if let Some(meta) = parse_helper(file) {
        let data: Value = from_str(&meta.raw).unwrap_or_default();

        let value = json!({
            "meta": {
                "filename": meta.filename,
                "raw_content": meta.raw
            },
            "name": meta.name,
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
        for_each: list.to_owned(),
        for_query: json.to_owned(),
    })
}
