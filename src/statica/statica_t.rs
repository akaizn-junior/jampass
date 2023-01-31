use crate::statica::statica_c::SP;
use serde_json::{to_string_pretty, Value};
use std::{collections::HashMap, ops::AddAssign, path::PathBuf};

pub struct FileMeta<'m> {
    pub name: &'m str,
    pub filename: String,
    pub raw: String,
}

pub type DataEntryList = Vec<DataEntry>;

#[derive(Debug, Default, Clone)]
pub struct DataEntry {
    pub file: PathBuf,
    pub data: Value,
}

impl DataEntry {
    pub fn new(file: PathBuf, data: Value) -> Self {
        Self { file, data }
    }

    // pub fn to_string(self) -> String {
    //     format!("\nfile: {:?}\ndata: {:?}", self.file, self.data)
    // }
}

pub struct Data {
    pub for_each: Vec<DataEntry>,
    pub length: usize,
}

impl Data {
    pub fn _list_to_string(&self) -> String {
        let mut res = String::new();
        res.push_str("[");

        for val in self.for_each.iter() {
            let formatted = format!("\n{}", to_string_pretty(&val.data).ok().unwrap_or_default());
            res.push_str(&formatted);
        }

        res.push_str("]");
        return res;
    }
}

/// Content checksum Type
pub struct Checksum {
    pub as_hex: String,
}

#[derive(Debug, Clone, Default)]
pub struct Cursor {
    pub line: usize,
    pub col: usize,
}

/// Metadata for a component being processed
#[derive(Debug, Clone)]
pub struct Meta {
    pub name: String,
    pub file: PathBuf,
    pub cursor: Cursor,
}

/// Data for a component being processed
#[derive(Debug, Clone)]
pub struct Proc {
    /// props passed to the component
    pub meta: Meta,
    pub html: String,
    pub is_fragment: Option<bool>,
    pub props: Option<PropMap>,
    /// keeps count of how may times a component is rendered
    pub usage: i32,
    pub usage_html: Option<String>,
    pub usage_inner_html: Option<String>,
    pub usage_props: Option<PropMap>,
}

impl Proc {
    /// Increment the usage count
    pub fn inc_usage(&mut self, value: i32) {
        self.usage.add_assign(value);
    }

    /// Add props passed to the components
    pub fn usage_props_mut(&mut self) -> &mut Option<PropMap> {
        &mut self.usage_props
    }

    pub fn usage_inner_html_mut(&mut self) -> &mut Option<String> {
        &mut self.usage_inner_html
    }

    pub fn usage_html_mut(&mut self) -> &mut Option<String> {
        &mut self.usage_html
    }

    pub fn is_fragment_mut(&mut self) -> &mut Option<bool> {
        &mut self.is_fragment
    }

    pub fn props_mut(&mut self) -> &mut Option<PropMap> {
        &mut self.props
    }
}

pub struct Unlisted {
    pub meta: Meta,
    pub html: String,
}

pub struct Linked {
    pub file: PathBuf,
    pub asset: PathBuf,
    pub is_component: bool,
}

pub struct TransformOutput {
    pub linked_list: Vec<Linked>,
    pub code: String,
}

/// Defines a scoped CSS selector
pub struct ScopedSelector {
    pub class: String,
    pub name: String,
}

impl ScopedSelector {
    const CLASS_SELECTOR_TOKEN: &'static str = ".";
    const INFIX: &'static str = "_x_";

    pub fn new(selector: &str, scope: &str) -> Self {
        let scoped_selector = format!("{selector}{}{scope}", Self::INFIX);

        let name = if selector.starts_with(Self::CLASS_SELECTOR_TOKEN) {
            let mut split = selector.split(".");
            // skip the first index
            split.next();
            let name = split.next().unwrap();
            format!("{name}{}{scope}", Self::INFIX)
        } else {
            format!("{selector}{}{scope}", Self::INFIX)
        };

        // make it a class if its not
        let class = if scoped_selector.starts_with(Self::CLASS_SELECTOR_TOKEN) {
            scoped_selector
        } else {
            format!("{}{scoped_selector}", Self::CLASS_SELECTOR_TOKEN)
        };

        Self { class, name }
    }

    pub fn is_scoped(slice: &str) -> bool {
        let item = slice.split(Self::INFIX);
        let has_scope = item.count() > 1;
        has_scope
    }
}

#[derive(Debug, Clone, Default)]
pub struct PropMeta {
    pub source: String,
}

#[derive(Debug, Clone)]
pub struct Prop {
    pub name: String,
    pub default: Option<String>,
    pub value: Option<String>,
    /// a list of ways a prop can be used
    pub templates: Vec<String>,
    pub meta: PropMeta,
}

impl Prop {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            default: None,
            value: None,
            templates: vec![
                format!("(\"{}\")", name.to_string()),
                format!("(\'{}\')", name.to_string()),
                format!("--{}", name.to_string()),
                format!("$value(\"{}", name.to_string()),
            ],
            meta: PropMeta::default(),
        }
    }

    pub fn default_mut(&mut self) -> &mut Option<String> {
        &mut self.default
    }

    pub fn value_mut(&mut self) -> &mut Option<String> {
        &mut self.value
    }

    pub fn prop_meta_mut(&mut self) -> &mut PropMeta {
        &mut self.meta
    }

    pub fn to_string(&self) -> String {
        if self.name.is_empty() {
            return String::new();
        }

        format!(
            "{}=\"{}\"{SP}",
            self.name,
            self.value.as_ref().unwrap_or(&"".to_string())
        )
    }
}

/// A dictionary type for component props
pub type PropMap = HashMap<String, Prop>;

#[derive(Debug, Clone)]
pub struct Props {
    pub map: PropMap,
}

impl Props {
    pub fn new(props: PropMap) -> Self {
        Self { map: props }
    }

    /// Inserts a prop to the prop map, if the prop already exists, updates its value
    pub fn add_prop(&mut self, name: &str, value: Option<String>) {
        let mut prop = Prop::new(name);
        *prop.value_mut() = value.to_owned();

        self.map
            .entry(name.to_string())
            .and_modify(|exists| {
                let exists_value = exists.value_mut().as_mut();

                if let Some(insert) = exists_value {
                    if let Some(val) = value {
                        let to_append = format!("{SP}{val}");
                        insert.push_str(&to_append);
                    }
                }
            })
            .or_insert(prop);
    }

    pub fn to_string(self) -> String {
        let acc = &mut String::new();
        self.map
            .values()
            .fold(acc, |acc: &mut String, attr| {
                acc.push_str(&attr.to_string());
                acc
            })
            .to_string()
    }
}

pub struct Directive {
    pub render_count: usize,
    pub props: PropMap,
    pub data: DataEntryList,
}
