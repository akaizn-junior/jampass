extern crate adler;
extern crate scraper;

use adler::adler32_slice;
use scraper::{Html, Selector};

use std::{
    fs::{create_dir_all, read_to_string, remove_file, rename, write},
    path::{Path, PathBuf},
};

use crate::{
    core_t::{Opts, Result},
    env,
    util::memory::{File, Memory},
    util::path,
};

#[derive(Debug)]
pub struct Inject {
    pub css: Vec<PathBuf>,
    pub js: Vec<PathBuf>,
    pub html: Vec<PathBuf>,
}

pub fn read_code(file: &PathBuf) -> Result<String> {
    let content = read_to_string(file)?;
    Ok(content)
}

/// Recursively create the full output path then write to it
fn recursive_output(file: &PathBuf, contents: String) -> Result<()> {
    // consider using write! for format strings

    fn write_file(owd: &PathBuf, contents: &String) -> Result<()> {
        write(owd, contents)?;
        Ok(())
    }

    let owd = path::prefix_with_owd(&file);

    // if file does not exist
    // create and write to it
    if owd.metadata().is_err() {
        let parent = owd.parent().unwrap_or(Path::new("."));

        if parent.metadata().is_err() {
            create_dir_all(parent)?;
        }
    }

    write_file(&owd, &contents)?;

    Ok(())
}

pub fn is_template(code: &String) -> bool {
    let template_tag_token = "<template";
    let ccode = code.trim();
    ccode.starts_with(template_tag_token)
}

fn evaluate_href(file: &PathBuf, href: &str) -> Option<PathBuf> {
    if href.is_empty() {
        return None;
    }

    let cwd = env::current_dir();
    let root = path::strip_cwd(file);
    let root_dir = root.parent().unwrap();

    let mut t_path = cwd.join(root_dir).join(&href);

    if href.starts_with("./") {
        let hh = href.replacen("./", "", 1);
        t_path = cwd.join(root_dir).join(&hh);
    }

    if href.starts_with("/") {
        let hh = href.replacen("/", "", 1);
        t_path = cwd.join(&hh);
    }

    Some(t_path)
}

pub fn html(_config: &Opts, file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let code = read_code(&file)?;
    let checksum = adler32_slice(code.as_bytes());

    // if the code indicates that this html file is a template, skip it
    if is_template(&code) {
        return Ok(());
    }

    let mut parsed_code = parse_html(file, code, memo)?;
    parsed_code = source_clean_up(parsed_code);

    construct_templates_script(memo);
    construct_templates_style(memo);

    // verify if the path has already been evaluated
    // or if the output does not exist
    if !memo.files.contains_key(&checksum) {
        memo.files
            .insert(checksum, File { checksum })
            .unwrap_or(File::default());

        recursive_output(&file, parsed_code)?;
    }

    Ok(())
}

fn str_to_selector(s: &str) -> Option<Selector> {
    let result = Selector::parse(s);
    result.ok()
}

fn parse_html(file: &PathBuf, code: String, memo: &mut Memory) -> Result<String> {
    let doc = Html::parse_document(&code);
    let o_link = str_to_selector("link");

    let mut result = code;

    if o_link.is_some() {
        let link = o_link.unwrap();
        let linked = doc.select(&link);

        for link in linked {
            let link_rel = link.value().attr("rel").unwrap_or("");
            let c_id = link.value().attr("id");

            // and the c is for component

            if link_rel == "component" {
                let c_href = link.value().attr("href").unwrap_or("");
                let c_path = evaluate_href(file, c_href).unwrap_or(PathBuf::new());

                if c_id.is_some() {
                    let tag_id = c_id.unwrap();
                    let p_code = parse_component(c_path, tag_id, memo)?;
                    let static_code = replace_component_with_static(result, tag_id, p_code);
                    result = static_code;
                }
            }
        }
    }

    Ok(result)
}

fn source_clean_up(source: String) -> String {
    const LINE_SEPARATOR: &str = "\n";
    let lines = source.lines();
    let mut result = String::new();

    for line in lines {
        // naive remove linked components, even if its commented
        if line.find("rel=\"component\"").is_some() {
            continue;
        }

        // remove empty lines
        if line.is_empty() {
            continue;
        }

        result.push_str(line);
        result.push_str(LINE_SEPARATOR);
    }

    return result;
}

fn replace_component_with_static(source: String, tag_id: &str, slice: String) -> String {
    let tag_start = format!("<{}", tag_id);
    let tag_end = format!("</{}>", tag_id);

    let mut result = source;

    // and the i is for index

    let mut tag_start_i = result.find(&tag_start);
    let mut tag_end_i = result.find(&tag_end);

    while tag_start_i.is_some() && tag_end_i.is_some() {
        // and the t is for tag
        let t_start_i = tag_start_i.unwrap();
        // get the end index of the tag_end
        let t_end_i = tag_end_i.unwrap() + tag_end.len();

        result.replace_range(t_start_i..t_end_i, &slice);

        // find more occurences
        tag_start_i = result.find(&tag_start);
        tag_end_i = result.find(&tag_end);
    }

    return result;
}

fn get_checksum(slice: &str) -> String {
    let slice_as_u32 = adler32_slice(slice.as_bytes());
    format!("{:x}", slice_as_u32) // u32 as HEX number
}

fn parse_component(file: PathBuf, c_id: &str, memo: &mut Memory) -> Result<String> {
    let c_sel_str = format!("template[id={}]", c_id);
    let c_selector = str_to_selector(&c_sel_str);

    if c_selector.is_some() {
        let c_code = read_code(&file)?;
        let component = Html::parse_fragment(&c_code);
        let selector = c_selector.unwrap();
        let c_template = component.select(&selector).next();

        if c_template.is_some() {
            let template = c_template.unwrap();
            // and the t is for template
            let mut t_code = template.inner_html();
            let style_selector = str_to_selector("style").unwrap();
            let script_selector = str_to_selector("script").unwrap();

            let style_tags = template.select(&style_selector);
            for style_tag in style_tags {
                let scope = get_checksum(&style_tag.html());

                let entry = memo.templates.entry("style".to_string()).or_default();
                entry.insert(scope, style_tag.inner_html());

                t_code = t_code.replace(&style_tag.html(), "");
            }

            let script_tags = template.select(&script_selector);
            for script_tag in script_tags {
                let scope = get_checksum(&script_tag.html());

                let entry = memo.templates.entry("script".to_string()).or_default();
                entry.insert(scope, script_tag.inner_html());

                t_code = t_code.replace(&script_tag.html(), "");
            }

            let scope = get_checksum(&t_code);

            let out_tag = format!(
                "<div id=\"{}\" data-scope=\"{}\">{}</div>",
                c_id, scope, t_code
            );

            return Ok(out_tag);
        }
    }

    Ok("".to_string())
}

fn construct_templates_style(memo: &mut Memory) {
    let style = memo.templates.get("style");
    let mut result = String::new();

    if style.is_some() {
        let data = style.unwrap();
        for val in data.values() {
            result = format!("{}\n{}", result, val);
        }
        result = format!("<style>{}</style>", result);
    }

    println!("{}", result);
}

fn construct_templates_script(memo: &mut Memory) {
    let script = memo.templates.get("script");
    let mut result = String::new();

    if script.is_some() {
        let data = script.unwrap();
        for val in data.values() {
            result = format!("{}\n{}", result, val);
        }
        result = format!("<script>{}</script>", result);
    }

    println!("{}", result);
}

pub fn _css(_config: &Opts, file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let code = read_code(&file)?;
    let checksum = adler32_slice(code.as_bytes());

    if !memo.files.contains_key(&checksum) {
        memo.files
            .insert(checksum, File { checksum })
            .unwrap_or(File::default());

        recursive_output(&file, code)?;
    }

    Ok(())
}

pub fn _js(_config: &Opts, file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let code = read_code(&file)?;
    let checksum = adler32_slice(code.as_bytes());

    if !memo.files.contains_key(&checksum) {
        memo.files
            .insert(checksum, File { checksum })
            .unwrap_or(File::default());

        recursive_output(&file, code)?;
    }

    Ok(())
}

pub fn env(_config: &Opts, file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let _code = read_code(&file)?;
    // reload env vars at this point
    env::eval_dotenv();

    if memo.watch_mode {
        let latest = env::latest();

        // TODO: properly evaluate last edited env var, not just last added
        // TODO: check if dotenv throws an event from edited var
        println!("Added env var \"{}\"", latest.0);
    }

    Ok(())
}

pub fn _any(_config: &Opts, file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let code = read_code(&file)?;
    let checksum = adler32_slice(code.as_bytes());

    if !memo.files.contains_key(&checksum) {
        memo.files
            .insert(checksum, File { checksum })
            .unwrap_or(File::default());

        recursive_output(&file, code)?;
    }

    Ok(())
}

pub fn remove(paths: Vec<PathBuf>) -> Result<()> {
    for p in paths {
        let owd_path = path::prefix_with_owd(&p);
        // remove only if path exists
        if owd_path.metadata().is_ok() {
            remove_file(owd_path)?
        }
    }

    Ok(())
}

pub fn rename_output(from: PathBuf, to: PathBuf) -> Result<()> {
    let ffrom = path::prefix_with_owd(&from);
    let tto = path::prefix_with_owd(&to);

    if ffrom.metadata().is_ok() {
        rename(ffrom, tto)?;
    }

    Ok(())
}
