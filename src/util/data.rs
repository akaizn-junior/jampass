use serde_json::{json, Map, Result as SerdeJsonResult, Value};

use crate::util::path;
use std::path::PathBuf;

pub struct Data {
    pub as_list: Vec<Value>,
    pub as_json: Map<String, Value>,
}

pub fn get_data() -> SerdeJsonResult<Data> {
    let data_files = path::read_data().ok().unwrap();

    /// Transforms a path into a JSON Object
    fn transform_path_into_object(file: &PathBuf) -> (String, Value) {
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
            let part_name = part_path.file_name();

            if part_name == None {
                return acc;
            }

            let name = part_name.unwrap().to_string_lossy().to_string();

            if part_path.extension().is_some() {
                let value = json!({
                    "meta": {
                        "filename": name.to_owned(),
                        "raw_content": ""
                    },
                    "name": name.to_owned(),
                });

                let key = format!("/{}", acc.0);
                let val = acc.1.pointer_mut(&key);

                // if it has a parent object
                if let Some(o) = val {
                    // finally insert the value
                    *o = json!({
                        {name.to_owned()}: value
                    });

                    *acc.1 = o.to_owned();
                } else {
                    *acc.0 = name;
                    *acc.1 = value;
                }

                return acc;
            }

            if acc.0 == "data" {
                *acc.1 = json!({
                    {name.to_owned()}: {}
                });

                // next key
                *acc.0 = name;
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

    let as_list = &mut vec![];
    let as_json = &mut Map::new();

    for file in data_files {
        // skip if file DNE
        if file.metadata().is_err() {
            continue;
        }

        let ext = file.extension().and_then(|s| s.to_str());
        if ext == Some("md") || ext == Some("json") {
            let obj = transform_path_into_object(&file);
            as_list.push(obj.1.to_owned());
            as_json.insert(obj.0, obj.1);
        }
    }

    Ok(Data {
        as_list: as_list.to_owned(),
        as_json: as_json.to_owned(),
    })
}
