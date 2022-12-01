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

/// Just the UNIX line separator
const LINE_SEPARATOR: &str = "\n";

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

fn is_template(code: &String) -> bool {
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

fn str_to_selector(s: &str) -> Option<Selector> {
    let result = Selector::parse(s);
    result.ok()
}

/// Generates a checksum as an Hex string from a string slice
fn checksum(slice: &str) -> String {
    let slice_as_u32 = adler32_slice(slice.as_bytes());
    format!("{:x}", slice_as_u32) // u32 as HEX number
}

fn valid_component_name(c_id: &str) -> bool {
    const STATIC_COMPONENT_NAME_TOKEN: &str = "x-";
    c_id.starts_with(STATIC_COMPONENT_NAME_TOKEN)
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
                    // generate a selector for the linked component
                    let component_selector = str_to_selector(tag_id);

                    // if the selector is valid
                    if component_selector.is_some() {
                        let selector = component_selector.unwrap();
                        // verify if the linked component is actually used
                        let component = doc.select(&selector).next();

                        // skipped undeclared linked component
                        if component.is_none() {
                            println!("Linked component {:?} not used, ignored", tag_id);
                            continue;
                        }
                    }

                    if !valid_component_name(tag_id) {
                        println!("Invalid component name \"{tag_id}\"");
                        continue;
                    }

                    let p_code = parse_component(c_path, tag_id, memo)?;
                    let static_code = replace_component_with_static(result, tag_id, p_code);
                    result = static_code;
                }
            }
        }
    }

    Ok(result)
}

fn source_check_up(source: String) -> String {
    const HTML_COMMENT_START_TOKEN: &str = "<!--";
    const STATIC_COMPONENT_TAG_START_TOKEN: &str = "<x-";

    let lines = source.lines();
    let mut result = String::new();

    /// Reads the name of a possible custom tag under special conditions
    fn custom_tag_name(html_line: &str) -> Option<&str> {
        let start_token = html_line.find("<");
        let end_token = html_line.find(">");

        if start_token.is_none() || end_token.is_none() {
            return Some("");
        }

        html_line.get(start_token.unwrap() + 1..end_token.unwrap())
    }

    for line in lines {
        let trimmed = line.trim();

        let comment = trimmed.starts_with(HTML_COMMENT_START_TOKEN);
        let component_link = trimmed.find("rel=\"component\"");

        // remove linked components
        if !comment && component_link.is_some() {
            continue;
        }

        // notify and remove unprocessed static component
        if trimmed.starts_with(STATIC_COMPONENT_TAG_START_TOKEN) {
            let unknown_name = custom_tag_name(trimmed).unwrap();
            println!("Undefined static component {:?} removed", unknown_name);
            continue;
        }

        let dash = trimmed.find("-");
        let space = trimmed.find(" ");
        let tag_end_token = trimmed.find(">");

        // notify usage of possible web component
        if trimmed.starts_with("<")
            && !trimmed.starts_with("</") // ignore end tags
            && dash.is_some()
            && space.is_none() // ignore meta tags duh!
            && tag_end_token.is_some()
            && (dash.unwrap() < tag_end_token.unwrap())
        {
            let name = custom_tag_name(trimmed).unwrap();
            println!("Web component used here {:?} ignored", name);
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

fn parse_component(file: PathBuf, c_id: &str, memo: &mut Memory) -> Result<String> {
    let c_sel_str = format!("template[id={}]", c_id);
    let c_selector = str_to_selector(&c_sel_str);

    if c_selector.is_some() {
        let c_code = read_code(&file)?;
        let component = Html::parse_fragment(&c_code);
        let selector = c_selector.unwrap();
        let c_template = component.select(&selector).next();

        // if an element is not found
        // lets assume
        // 1 - tag is not "template" tag
        // 2 - the id is not a valid id
        if c_template.is_none() {
            println!("Components must be defined as a template tag and have a valid id");
            return Ok("".to_string());
        }

        if c_template.is_some() {
            let template = c_template.unwrap();
            let c_id = template.value().attr("id").unwrap();

            // and the t is for template
            let mut t_code = template.inner_html();
            let component_scope = checksum(&t_code);

            let style_selector = str_to_selector("style").unwrap();
            let script_selector = str_to_selector("script").unwrap();

            let style_tag = template.select(&style_selector).next();
            let script_tag = template.select(&script_selector).next();

            if style_tag.is_some() {
                let tag = style_tag.unwrap();
                let css_code = tag.inner_html();
                let mut scoped_css = String::new();

                let style_checksum = checksum(&css_code);

                for line in css_code.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    let open_token = "{";
                    if trimmed.contains(open_token) {
                        let scoped_selector =
                            format!("\n[data-scope={:?}] {}\n", component_scope, trimmed);
                        scoped_css.push_str(&scoped_selector);
                        continue;
                    }

                    scoped_css.push_str(line);
                    scoped_css.push_str(LINE_SEPARATOR);
                }

                let entry = memo.templates.entry("style".to_string()).or_default();
                entry.insert(style_checksum, scoped_css);

                t_code = t_code
                    .split(&tag.html())
                    .collect::<Vec<&str>>()
                    .join("")
                    .trim()
                    .to_string();
            }

            if script_tag.is_some() {
                let tag = script_tag.unwrap();
                let script_code = tag.inner_html();
                let script_checksum = checksum(&script_code);
                let scoped_script_code =
                    format!("\n{{//{}\n{}\n}}", component_scope, script_code.trim());

                let entry = memo.templates.entry("script".to_string()).or_default();
                entry.insert(script_checksum, scoped_script_code);

                t_code = t_code
                    .split(&tag.html())
                    .collect::<Vec<&str>>()
                    .join("")
                    .trim()
                    .to_string();
            }

            let out_tag = format!(
                "\t<div id=\"{c_id}\" data-scope=\"{component_scope}\">\n\t{t_code}\n\t</div>"
            );

            return Ok(out_tag);
        }
    }

    Ok("".to_string())
}

fn construct_components_style(memo: &mut Memory) -> String {
    let style = memo.templates.get("style");
    let mut result = String::new();

    if style.is_some() {
        let data = style.unwrap();
        for val in data.values() {
            result.push_str(val);
            result.push_str(LINE_SEPARATOR);
        }
        result = format!("<style>{result}</style>");
    }

    return result;
}

fn construct_components_script(memo: &mut Memory) -> String {
    let script = memo.templates.get("script");
    let mut result = String::new();

    if script.is_some() {
        let data = script.unwrap();
        for val in data.values() {
            result.push_str(val);
            result.push_str(LINE_SEPARATOR);
        }
        result = format!("<script>{result}</script>");
    }

    return result;
}

fn add_components_style(mut source: String, slice: String) -> String {
    let head_tag_close = "</head>";

    let mut style_tag = slice;
    style_tag.push_str(LINE_SEPARATOR);
    style_tag.push_str(head_tag_close);

    source = source
        .split(head_tag_close)
        .collect::<Vec<&str>>()
        .join(&style_tag)
        .trim()
        .to_string();

    source
}

fn add_components_script(mut source: String, slice: String) -> String {
    let body_tag_close = "</body>";

    let mut script_tag = slice;
    script_tag.push_str(LINE_SEPARATOR);
    script_tag.push_str(body_tag_close);

    source = source
        .split(body_tag_close)
        .collect::<Vec<&str>>()
        .join(&script_tag)
        .trim()
        .to_string();

    source
}

// Interface

pub fn html(_config: &Opts, file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let code = read_code(&file)?;
    let checksum = adler32_slice(code.as_bytes());

    // if the code indicates that this html file is a template, skip it
    if is_template(&code) {
        return Ok(());
    }

    let mut parsed_code = parse_html(file, code, memo)?;
    parsed_code = source_check_up(parsed_code);

    let script = construct_components_script(memo);
    let style = construct_components_style(memo);

    parsed_code = add_components_style(parsed_code, style);
    parsed_code = add_components_script(parsed_code, script);

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
