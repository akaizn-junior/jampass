use adler::adler32_slice;
use scraper::{Html, Selector};

use std::{
    ffi::OsStr,
    fs::{copy, create_dir_all, read_to_string, remove_file, rename, write},
    path::{Path, PathBuf},
};

use crate::{
    core_t::{Opts, Result},
    env,
    util::memory::{File, Memory},
    util::path,
};

/// Type for content checkum
struct Checksum {
    as_hex: String,
    as_u32: u32,
}

// **** CONSTANTS

/// Just the UNIX line separator aka newline (NL)
const NL: &str = "\n";
const STATIC_QUERY_FN_TOKEN: &str = "$query";
const QUERY_FACTORY_TOKEN: &str = "__xQueryByScope";
const QUERY_FN_NAME: &str = "query";
const DATA_SCOPE_TOKEN: &str = "data-X-SCOPE";
const HTML_COMMENT_START_TOKEN: &str = "<!--";
const COMPONENT_TAG_START_TOKEN: &str = "<x-";
const CSS_SELECTOR_OPEN_TOKEN: &str = "{";
const CSS_AT_TOKEN: &str = "@";
const HEAD_TAG_CLOSE: &str = "</head>";
const BODY_TAG_CLOSE: &str = "</body>";
const COMPONENT_PREFIX_TOKEN: &str = "x-";
const SPACE: &str = " ";
const JS_CLIENT_CORE_PATH: &str = "src/util/js/client_core.js";
const GLOBAL_STYLE_ID: &str = "__X-STYLE__";
const GLOBAL_SCRIPT_ID: &str = "__X-SCRIPT__";
const GLOBAL_CORE_SCRIPT_ID: &str = "__X-CORE-SCRIPT__";

// **** end CONSTANTS

/// Takes a string splits it two and joins it with a new slice thus replacing a chunk
fn replace_chunk(text: String, cut_slice: &str, add_slice: &str) -> String {
    text.split(cut_slice)
        .collect::<Vec<&str>>()
        .join(add_slice)
        .trim()
        .to_string()
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

fn evaluate_href(entry_file: &PathBuf, linked_file: &str) -> Option<PathBuf> {
    if linked_file.is_empty() {
        return None;
    }

    let cwd = env::current_dir();
    let file_endpoint = path::strip_cwd(entry_file);
    let file_parent = file_endpoint.parent().unwrap();

    // consider all linked paths to be relative to the main entry
    let mut component_path = cwd.join(file_parent).join(&linked_file);

    // evaluate if linked starts with this symbol
    if linked_file.starts_with("./") {
        // consider linked to be relative to  main
        let relative_href = linked_file.replacen("./", "", 1);
        component_path = cwd.join(file_parent).join(&relative_href);
    }

    // if linked starts with this symbol
    if linked_file.starts_with("/") {
        // consider linked to be an absolute path, relative to the CWD
        let absolute_href = linked_file.replacen("/", "", 1);
        component_path = cwd.join(&absolute_href);
    }

    Some(component_path)
}

fn str_to_selector(s: &str) -> Option<Selector> {
    let result = Selector::parse(s);
    result.ok()
}

/// Generates a checksum as an Hex string from a string slice
fn checksum(slice: &str) -> Checksum {
    let as_u32 = adler32_slice(slice.as_bytes());
    let as_hex = format!("{:x}", as_u32);

    return Checksum { as_hex, as_u32 };
}

fn valid_component_id(c_id: &str) -> bool {
    c_id.starts_with(COMPONENT_PREFIX_TOKEN)
}

fn parse_html(file: &PathBuf, code: &String, memo: &mut Memory) -> Result<String> {
    let doc = Html::parse_document(&code);
    let o_link = str_to_selector("link");

    let mut result = code.clone();

    if o_link.is_some() {
        let link = o_link.unwrap();
        let linked = doc.select(&link);

        for link in linked {
            let link_rel = link.value().attr("rel").unwrap_or("");
            let link_href = link.value().attr("href").unwrap_or("");
            let link_id = link.value().attr("id");
            let link_path = evaluate_href(file, link_href).unwrap_or(PathBuf::new());

            // if the linked asset does not exist, skip this
            if link_path.metadata().is_err() {
                continue;
            }

            // evaluate all linked
            let linked_code = read_code(&link_path)?;
            // calculates the checksum of the linked content
            let linked_checksum = checksum(&linked_code).as_hex;
            // calculate the checksum of the main file's content
            let code_checksum = checksum(&result).as_u32;

            let linked_entries = memo.linked.entry(linked_checksum).or_default();
            linked_entries.push(code_checksum);

            // and the c is for component

            if link_rel == "component" {
                if link_id.is_some() {
                    let c_id = link_id.unwrap();
                    // generate a selector for the linked component
                    let c_selector = str_to_selector(c_id);

                    // if the selector is valid
                    if c_selector.is_some() {
                        let selector = c_selector.unwrap();
                        // verify if the linked component is actually used
                        let component = doc.select(&selector).next();

                        // skipped undeclared linked component
                        if component.is_none() {
                            println!("Linked component {:?} not used, ignored", c_id);
                            continue;
                        }
                    }

                    if !valid_component_id(c_id) {
                        println!("Invalid component id \"{c_id}\"");
                        continue;
                    }

                    let parsed_code = parse_component(linked_code, c_id, memo)?;
                    let static_code = replace_component_with_static(&result, c_id, parsed_code);
                    result = static_code;
                }
            }
        }
    }

    Ok(result)
}

fn copy_file(from: &PathBuf, to: &PathBuf) -> Result<()> {
    // return the total number of bytes copied
    copy(from, to)?;
    Ok(())
}

fn evaluate_non_component_link_line(
    file: &PathBuf,
    line: &str,
    link_path_attr: &str,
) -> Result<Option<()>> {
    let frag = Html::parse_fragment(line);
    let attr = format!("[{link_path_attr}]");

    let sel = str_to_selector(&attr).unwrap();
    let tag = frag.select(&sel).next().unwrap();
    let attr_value = tag.value().attr(link_path_attr).unwrap();
    let full_path = evaluate_href(file, attr_value).unwrap();

    if full_path.metadata().is_ok() {
        let owd = path::prefix_with_owd(&full_path);
        copy_file(&full_path, &owd)?;
        return Ok(Some(()));
    }

    println!("{:?} does not exist. ignored", attr_value);
    Ok(None)
}

/// Evaluates the generated source code line by line
fn generated_code_eval(file: &PathBuf, source: String) -> Result<String> {
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

        // any other link but components link
        let component_link = trimmed.contains("rel=\"component\"");
        let any_link = trimmed.contains("<link") && trimmed.contains("href=") && !component_link;
        // any script with a src
        let any_src_script = trimmed.contains("<script") && trimmed.contains("src=");

        if !comment && any_link {
            let result = evaluate_non_component_link_line(file, trimmed, "href")?;

            if result.is_none() {
                continue;
            }
        }

        if !comment && any_src_script {
            let result = evaluate_non_component_link_line(file, trimmed, "src")?;

            if result.is_none() {
                continue;
            }
        }

        // notify and remove unprocessed static component
        if trimmed.starts_with(COMPONENT_TAG_START_TOKEN) {
            let unknown_name = custom_tag_name(trimmed).unwrap();
            println!("Undefined static component {:?} removed", unknown_name);
            continue;
        }

        let space_token = trimmed.find(SPACE);
        let dash = trimmed.find("-");
        let tag_end_token = trimmed.find(">");

        // notify usage of possible web component
        if trimmed.starts_with("<")
            && !trimmed.starts_with("</") // ignore end tags
            && dash.is_some()
            && (dash.unwrap() < space_token.unwrap()) // ignore meta tags duh!
            && tag_end_token.is_some()
            && (dash.unwrap() < tag_end_token.unwrap())
        {
            let name = custom_tag_name(trimmed).unwrap();
            println!("Web component used here {:?} ignored", name);
        }

        result.push_str(line);
        result.push_str(NL);
    }

    return Ok(result);
}

/// Replaces slot in a component with its placements
fn handle_component_placements(slice: &str, to_place: &str) -> String {
    let mut result = slice.to_string();
    let slice_doc = Html::parse_fragment(slice);
    let to_place_doc = Html::parse_fragment(to_place);

    // a selector for all [slots] aka placements
    let sel = str_to_selector("[slot]").unwrap();
    let place_items = to_place_doc.select(&sel);

    for place_item in place_items {
        let slot_name = place_item.value().attr("slot").unwrap_or("");
        // attribute containing the slot name
        let slot_name_as_attr = format!("[name={slot_name}]");
        // a selector for the specific named slot
        let sel = str_to_selector(&slot_name_as_attr).unwrap();
        let slot_ref = slice_doc.select(&sel).next();

        if slot_ref.is_some() {
            // the element of the slot
            let slot = slot_ref.unwrap();
            // the html of the tag to place
            let mut to_place_html = place_item.html();

            // specific slot attribute
            let name_attr = format!("slot=\"{slot_name}\"");
            // replace the slot attribute
            to_place_html = to_place_html.replace(&name_attr, "");

            // finally replace the slot with the placement
            result = replace_chunk(result, &slot.html(), &to_place_html);
        }
    }

    return result;
}

fn replace_component_with_static(source: &String, c_id: &str, slice: String) -> String {
    let tag_open_token = format!("<{}", c_id);
    let tag_close_token = format!("</{}>", c_id);
    let unpaired_close_token = "/>";

    let mut result = String::new();
    let src_code = source;
    let mut lines = src_code.lines();
    let mut line = lines.next();

    while line.is_some() {
        // trim this line of code
        let trimmed = line.unwrap().trim();
        // do not statically replace comments
        let comment = trimmed.starts_with(HTML_COMMENT_START_TOKEN);

        // immediately remove the link declaration to this component
        let c_id_attr = format!("id=\"{c_id}\"");
        let this_component_link =
            trimmed.contains("rel=\"component\"") && trimmed.contains(&c_id_attr);
        if !comment && this_component_link {
            // done! move on
            line = lines.next();
            continue;
        }

        // does this line contain a tag openning
        let tag_open = trimmed.contains(&tag_open_token);
        // should indicate the closing of an open tag
        let tag_close = trimmed.contains(&tag_close_token);
        // for when a component is declared as an unpaired tag
        let unpaired_close = trimmed.contains(&unpaired_close_token);

        // something line <tag />
        let unpaired = tag_open && unpaired_close;
        // something like <tag></tag> in the same line
        let one_liner_paired = tag_open && tag_close;
        // will contain placement tags inside a component
        let mut placements = String::new();

        if !comment && unpaired {
            result.push_str(&slice);
            result.push_str(NL);
            // done! move on
            line = lines.next();
            continue;
        }

        if !comment && one_liner_paired {
            // one liner paired tags may contain placements
            // capture them
            let close_i = trimmed.find(&tag_close_token).unwrap();
            // fint the index of the closing token ">" for the open token
            let closing_tok_i = trimmed.find(">").unwrap();
            // component placements
            let inner_html = trimmed.get(closing_tok_i + 1..close_i).unwrap();

            if !inner_html.is_empty() {
                placements.push_str(&inner_html);
            }

            let with_filled_slots = handle_component_placements(&slice, &placements);
            result.push_str(&with_filled_slots);
            result.push_str(NL);

            // done! move on
            line = lines.next();
            continue;
        }

        // if found a open tag, try to capture of its placements until tag close
        if !comment && !unpaired && tag_open {
            let mut next_line = lines.next().unwrap();

            // **** Capture all component placements
            // A placement is a tag that will replace a slot
            while !next_line.contains(&tag_close_token) {
                placements.push_str(next_line);
                next_line = lines.next().unwrap();
            }

            let with_filled_slots = handle_component_placements(&slice, &placements);

            result.push_str(&with_filled_slots);
            result.push_str(NL);
            // done! move on
            line = lines.next();
            continue;
        }

        result.push_str(trimmed);
        result.push_str(NL);
        // done! move on
        line = lines.next();
    }

    return result;
}

fn parse_component(c_code: String, c_id: &str, memo: &mut Memory) -> Result<String> {
    let c_sel_str = format!("template[id={}]", c_id);
    let c_selector = str_to_selector(&c_sel_str);

    if c_selector.is_some() {
        let component = Html::parse_fragment(&c_code);
        let selector = c_selector.unwrap();
        let c_template = component.select(&selector).next();

        // if an element is not found
        // lets safely assume by previous logic
        // 1 - tag is not a "template" tag
        // 2 - the id is not a valid id
        if c_template.is_none() {
            println!("Components must be defined as a template tag and have a valid id");
            return Ok("".to_string());
        }

        if c_template.is_some() {
            let template = c_template.unwrap();
            let fragment_attr = template.value().attr("data-fragment").unwrap_or("false");
            let is_fragment = fragment_attr == "true";

            // and the t is for template
            let mut t_code = template.inner_html();

            // ship it if its empty
            if t_code.is_empty() {
                return Ok("".to_string());
            }

            // fragments should not be scoped
            let component_scope = if is_fragment {
                "".to_string()
            } else {
                checksum(&t_code).as_hex
            };

            let style_selector = str_to_selector("style").unwrap();
            let script_selector = str_to_selector("script").unwrap();

            let style_tag = template.select(&style_selector).next();
            let script_tag = template.select(&script_selector).next();

            if style_tag.is_some() {
                let tag = style_tag.unwrap();
                let css_code = tag.inner_html();

                let evaled_css = evaluate_component_style(css_code, &component_scope);
                memo.component.style.push(evaled_css);

                t_code = replace_chunk(t_code, &tag.html(), "");
            }

            if script_tag.is_some() {
                let tag = script_tag.unwrap();
                let script_code = tag.inner_html();

                let evaled_code = evaluate_component_script(script_code, &component_scope);
                memo.component.script.push(evaled_code);

                t_code = replace_chunk(t_code, &tag.html(), "");
            }

            // if the component is a fragment, simply ship the html
            if is_fragment {
                return Ok(t_code.trim().to_string());
            }

            let component_html = Html::parse_fragment(&t_code.trim());
            let first_elem = component_html.root_element().first_child();

            if first_elem.is_some() {
                let node = first_elem.unwrap();
                let is_root_node = !node.has_siblings();

                if !is_root_node {
                    // if not a root node and not a fragment, wrap it with a div and ship it
                    return Ok(format!(
                        "<div {DATA_SCOPE_TOKEN}=\"{component_scope}\">{t_code}</div>"
                    ));
                }

                // if is a root node and not a fragment add the scope to it
                if is_root_node {
                    let elem = node.value().as_element();
                    if elem.is_some() {
                        let elem_name = elem.unwrap().name();
                        // tag-open-token of the root element
                        let tag_open = format!("<{elem_name}");
                        // the index of the tag open token
                        let tag_open_i = t_code.find(&tag_open).unwrap_or(0);
                        // get the closing token of the tag openning
                        let tag_open_close_i = t_code
                            .get(tag_open_i..)
                            .unwrap_or("")
                            .find(">")
                            .unwrap_or(1)
                            + tag_open_i;

                        // collect any previous set attributes
                        let attrs = t_code.get(tag_open.len()..tag_open_close_i).unwrap_or("");
                        let tag_with_attrs = format!("{tag_open}{attrs}");
                        // add the scope attribute
                        let scope_attr = format!(
                            "{tag_open}{attrs}{SPACE}{DATA_SCOPE_TOKEN}=\"{component_scope}\""
                        );

                        // now this!
                        let scoped_code = replace_chunk(t_code, &tag_with_attrs, &scope_attr);
                        return Ok(scoped_code);
                    }
                }
            }
        }
    }

    Ok("".to_string())
}

/// Handles client bound static functions
fn handle_static_fns(source: String, scope: &str) -> (String, String) {
    let mut src_code = source;
    let mut scoped_fns = String::new();

    // **** Define scoped functions

    let scoped_query_fn_name = format!("{}_{}", QUERY_FN_NAME, scope);
    let scoped_query_fn = format!(
        "function {}(sel) {{ return {}(sel, {:?}); }}",
        scoped_query_fn_name, QUERY_FACTORY_TOKEN, scope
    );

    // **** Register scoped functions

    let static_fns = vec![(STATIC_QUERY_FN_TOKEN, scoped_query_fn_name, scoped_query_fn)];

    // **** Replace static functions with their scoped counterparts

    for fns in static_fns {
        if src_code.contains(fns.0) {
            src_code = src_code.replace(fns.0, &fns.1);
            scoped_fns.push_str(NL);
            scoped_fns.push_str(&fns.2);
        }
    }

    return (scoped_fns, src_code);
}

fn evaluate_component_script(source: String, c_scope: &str) -> String {
    if !c_scope.is_empty() {
        // define the component's scoped function
        let scoped_fn_definition = format!("function x_{}()", c_scope);
        // evaluate all static functions
        let (scoped_fns, src_code) = handle_static_fns(source, c_scope);

        return format!(
            "{NL}({}{SPACE}{{{}{NL}{}}})();",
            scoped_fn_definition,
            scoped_fns,
            src_code.trim()
        );
    }

    return format!("{NL}{{{NL}{}{NL}}}", source.trim());
}

fn evaluate_component_style(source: String, scope: &str) -> String {
    let mut result = String::new();

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let css_selector =
            !trimmed.starts_with(CSS_AT_TOKEN) && trimmed.contains(CSS_SELECTOR_OPEN_TOKEN);

        if css_selector && !scope.is_empty() {
            let scoped_selector = format!("{NL}[{}={:?}] {}{NL}", DATA_SCOPE_TOKEN, scope, trimmed);
            result.push_str(&scoped_selector);
            continue;
        }

        result.push_str(line);
        result.push_str(NL);
    }

    result
}

fn construct_components_style(memo: &mut Memory) -> String {
    let mut result = String::new();

    for code in memo.component.style.iter() {
        result.push_str(code);
        result.push_str(NL);
    }

    if !result.is_empty() {
        result = format!("<style id=\"{GLOBAL_STYLE_ID}\">{result}</style>");
    }

    // clear the code for this session
    memo.component.style.clear();

    return result;
}

fn construct_components_script(memo: &mut Memory) -> String {
    let mut result = String::new();

    for code in memo.component.script.iter() {
        result.push_str(code);
        result.push_str(NL);
    }

    if !result.is_empty() {
        result = format!("<script id=\"{GLOBAL_SCRIPT_ID}\">{result}</script>");
    }

    // clear the code for this session
    memo.component.script.clear();

    return result;
}

fn add_components_style(source: String, slice: String) -> String {
    if slice.is_empty() {
        return source;
    }

    let style_id = format!("id=\"{GLOBAL_STYLE_ID}\"");

    if !source.contains(&style_id) {
        let mut style_tag = slice;
        style_tag.push_str(NL);
        style_tag.push_str(HEAD_TAG_CLOSE);

        return replace_chunk(source, HEAD_TAG_CLOSE, &style_tag);
    }

    source
}

fn add_components_script(source: String, slice: String) -> String {
    if slice.is_empty() {
        return source;
    }

    let script_id = format!("id=\"{GLOBAL_SCRIPT_ID}\"");

    if !source.contains(&script_id) {
        let mut script_tag = slice;
        script_tag.push_str(NL);
        script_tag.push_str(BODY_TAG_CLOSE);

        return replace_chunk(source, BODY_TAG_CLOSE, &script_tag);
    }

    source
}

fn add_core_script(source: String) -> Result<String> {
    let pkg_cwd = env::package_cwd();
    let file = pkg_cwd.join(JS_CLIENT_CORE_PATH);
    let code = read_code(&file);

    let script_id = format!("id=\"{GLOBAL_SCRIPT_ID}\"");

    if source.contains(&script_id) {
        let x_script_tag = format!("<script {script_id}>");
        let ccode = format!(
            "<script id=\"{GLOBAL_CORE_SCRIPT_ID}\">{NL}{}</script>{NL}{}",
            code.unwrap(),
            x_script_tag
        );

        return Ok(replace_chunk(source, &x_script_tag, &ccode));
    }

    Ok(source)
}

fn process_html(file: &PathBuf, code: &String, memo: &mut Memory) -> Result<()> {
    let mut parsed_code = parse_html(file, &code, memo)?;
    parsed_code = generated_code_eval(file, parsed_code)?;

    let global_script_tag = construct_components_script(memo);
    let global_style_tag = construct_components_style(memo);

    parsed_code = add_components_style(parsed_code, global_style_tag);
    parsed_code = add_components_script(parsed_code, global_script_tag);
    parsed_code = add_core_script(parsed_code)?;

    recursive_output(&file, parsed_code)?;
    Ok(())
}

// Interface

pub fn is_component(file: &PathBuf) -> Result<bool> {
    let code = read_code(file)?;
    let template_tag_token = "<template";
    let ccode = code.trim();

    Ok(ccode.starts_with(template_tag_token))
}

pub fn html(_config: &Opts, file: &PathBuf, memo: &mut Memory) -> Result<()> {
    let code = read_code(&file)?;
    let checksum = checksum(&code);

    println!("File {:?}", file);

    // ignore empty code and components
    if code.is_empty() {
        return Ok(());
    }

    let file_as_str = file.to_str().unwrap();
    let processed = memo.files.entry(file_as_str.to_string()).or_default();
    let has_processed = processed.checksum.eq(&checksum.as_u32);

    // verify if the path has already been evaluated
    // or if the output does not exist
    if !has_processed {
        memo.files.insert(
            file_as_str.to_string(),
            File {
                checksum: checksum.as_u32,
                path: file.to_owned(),
            },
        );

        process_html(file, &code, memo)?;
    }

    Ok(())
}

/// env files should have .env extension or be named ".env"
pub fn is_env_file(file: &PathBuf) -> bool {
    file.file_name() == Some(OsStr::new(".env")) || file.ends_with(".env")
}

pub fn env(_config: &Opts, _file: &PathBuf, memo: &mut Memory) -> Result<()> {
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

pub fn rename_output(from: &PathBuf, to: &PathBuf) -> Result<()> {
    let ffrom = path::prefix_with_owd(from);
    let tto = path::prefix_with_owd(to);

    if ffrom.metadata().is_ok() {
        rename(ffrom, tto)?;
    }

    Ok(())
}
