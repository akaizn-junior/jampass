use adler::adler32_slice;
use std::{collections::HashMap, fs::read_to_string, ops::AddAssign, path::PathBuf, str::Lines};

use crate::{
    core_t::{Emoji, Result},
    env,
    util::path,
};

// *** TYPES ***

/// Type for content checkum
struct Checksum {
    as_hex: String,
}

// *** CONSTANTS ***

/// Just the UNIX line separator aka newline (NL)
const NL: &str = "\n";
// const STATIC_QUERY_FN_TOKEN: &str = "$query";
// const QUERY_FACTORY_TOKEN: &str = "__xQueryByScope";
// const QUERY_FN_NAME: &str = "query";
const DATA_SCOPE_TOKEN: &str = "data-x-scope";
const DATA_NESTED_TOKEN: &str = "data-x-nested";
const DATA_COMPONENT_NAME: &str = "data-x-name";
const HTML_COMMENT_START_TOKEN: &str = "<!--";
const HTML_COMMENT_END_TOKEN: &str = "-->";
const COMPONENT_TAG_START_TOKEN: &str = "<x-";
// const CSS_OPEN_RULE_TOKEN: &str = "{";
// const CSS_AT_TOKEN: &str = "@";
// const HEAD_TAG_CLOSE: &str = "</head>";
// const BODY_TAG_CLOSE: &str = "</body>";
const COMPONENT_PREFIX_TOKEN: &str = "x-";
/// Space token
const SP: &str = " ";
// const JS_CLIENT_CORE_PATH: &str = "src/util/js/client_core.js";
// const GLOBAL_STYLE_ID: &str = "__X-STYLE__";
// const GLOBAL_SCRIPT_ID: &str = "__X-SCRIPT__";
// const GLOBAL_CORE_SCRIPT_ID: &str = "__X-CORE-SCRIPT__";
const TEMPLATE_START_TOKEN: &str = "<template";
const TEMPLATE_END_TOKEN: &str = "</template";
const LINK_START_TOKEN: &str = "<link";
const UNPAIRED_TAG_CLOSE_TOKEN: &str = "/>";

// *** HELPERS ***

/// Collects a slice line by line until an end token is found
/// end token line exclusive
fn collect_until_end_token(lines: &mut Lines, end_token: &str) -> String {
    let mut line = lines.next();
    let mut result = String::new();

    if line.is_some() {
        let trimmed = line.unwrap().trim();
        let mut next_line = trimmed;

        while !next_line.contains(end_token) {
            line = lines.next();
            result.push_str(next_line);
            result.push_str(NL);
            next_line = line.unwrap().trim();
        }
    }

    return result;
}

/// Collects a slice line by line until one of the end tokens is found
fn collect_until_an_end_token(lines: &mut Lines, end_tokens: Vec<&str>) -> String {
    let mut line = lines.next();
    let mut result = String::new();

    if line.is_some() {
        let trimmed = line.unwrap().trim();
        let mut next_line = trimmed;

        // on each iteration calculate if one of the tokens was found
        while end_tokens
            .iter()
            .fold(true, |acc, &token| !next_line.contains(token) && acc)
        {
            line = lines.next();
            result.push_str(next_line);
            result.push_str(NL);
            next_line = line.unwrap().trim();
        }
    }

    return result;
}

/// Collects a slice from a start to an end token line by line
/// The line where the start token is found is completely skipped
fn collect_from_to<'s>(source: &str, start_token: &str, end_token: &str) -> String {
    let mut lines = source.lines();
    let mut line = lines.next();
    let mut result = String::new();

    if line.is_some() {
        let trimmed = line.unwrap().trim();
        let is_start = trimmed.contains(start_token);
        let is_inline = trimmed.contains(end_token);

        // both tokens may be inline, verify
        if is_start && is_inline {
            let start_i = trimmed.find(start_token).unwrap();
            let end_i = trimmed.find(end_token).unwrap();
            let slice = trimmed.get(start_i + start_token.len()..end_i).unwrap();
            result.push_str(slice);
            return result;
        }

        if is_start && !is_inline {
            // if here, the start token is on this line so
            // start lookup for the end token by the next line
            line = lines.next();
            let mut next_line = line.unwrap().trim();

            while !next_line.contains(end_token) {
                result.push_str(next_line);
                result.push_str(NL);
                line = lines.next();
                next_line = line.unwrap().trim();
            }
        }
    }

    return result;
}

fn get_valid_id(slice: &str) -> Option<&str> {
    if slice.starts_with(COMPONENT_PREFIX_TOKEN) {
        return Some(slice);
    }
    None
}

fn get_attr<'a>(slice: &'a str, token: &'a str) -> Option<&'a str> {
    let id_token = format!("{token}=\"");
    let start = slice.find(&id_token);

    if start.is_some() {
        let s_i = start.unwrap() + id_token.len();
        let end = slice.get(s_i..).unwrap_or("").find("\"");

        if end.is_some() {
            let e_i = end.unwrap_or(slice.len()) + s_i;
            let value = slice.get(s_i..e_i).unwrap_or("");
            return Some(value);
        }
    }

    None
}

fn get_attrs_inline<'a>(
    slice: &'a str,
    start_token: &'a str,
    end_token: &'a str,
) -> Option<&'a str> {
    let start = slice.find(&start_token);

    if start.is_some() {
        let s_i = start.unwrap() + start_token.len();
        let end = slice.get(s_i..).unwrap_or("").find(end_token);

        if end.is_some() {
            // is either the token index or the end of the string
            let e_i = end.unwrap_or(slice.len()) + s_i;
            let result = slice.get(s_i..e_i).unwrap_or("");

            if !result.is_empty() {
                return Some(result);
            }
        }
    }

    None
}

/// Generates a checksum as an Hex string from a string slice
fn checksum(slice: &str) -> Checksum {
    let as_u32 = adler32_slice(slice.as_bytes());
    let as_hex = format!("{:x}", as_u32);

    return Checksum { as_hex };
}

/// Evaluates the url of a linked file relative to the entry file or the CWD
fn evaluate_url(entry_file: &PathBuf, linked_file: &str) -> Option<PathBuf> {
    if linked_file.is_empty() {
        return None;
    }

    let cwd = env::current_dir();
    // path base
    let file_endpoint = path::strip_cwd(entry_file);
    // get the parent folder of the main entry file
    // so linked items are fetched relative to the right place
    let file_parent = file_endpoint.parent().unwrap();
    // consider all linked paths to be relative to the main entry
    let mut component_path = cwd.join(file_parent).join(&linked_file);

    // evaluate if linked starts with this symbol
    if linked_file.starts_with("./") {
        // consider linked to be relative to main
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

/// Replaces slot in a component with its placements
fn fill_component_slots(c_code: &String, placements: &str) -> String {
    let mut result = String::new();
    result.push_str(c_code);

    let lines = &mut placements.lines();
    let mut line = lines.next();

    while line.is_some() {
        let trimmed = line.unwrap().trim();
        let is_placement = trimmed.contains("slot=\"");

        if is_placement {
            let tag_name = get_tag_name(trimmed);
            let attrs = get_attrs_inline(trimmed, tag_name, ">").unwrap_or("");
            let slot_name = get_attr(attrs, "slot").unwrap_or("");
            let end_token = format!("</{tag_name}");
            let tag_html = collect_until_end_token(lines, &end_token);

            // attribute containing the slot name
            let slot_name_attr = format!("name=\"{slot_name}\"");

            let slot_lines = &mut c_code.lines();
            let mut line = lines.next();

            while line.is_some() {
                let trimmed = line.unwrap().trim();
                let is_slot = trimmed.contains(&slot_name_attr);

                if is_slot {
                    let slot = collect_until_end_token(slot_lines, "</slot");
                    // finally replace the slot with the placement
                    result = replace_chunk(&result, &slot, &tag_html);
                }

                line = lines.next();
            }
        }

        line = lines.next();
    }

    return result;
}

fn log(label: &str, msg: &str) {
    println!("\n{} => {label} = {msg}\n", file!());
}

fn replace_component_with_static(
    c_line: &str,
    lines: &mut Lines,
    c_id: &str,
    c_html: &String,
) -> String {
    let tag_open_token = format!("<{}", c_id);
    let tag_close_token = format!("</{}", c_id);

    let mut result = String::new();
    let mut line = Some(c_line);

    let mut write = |line| {
        result.push_str(line);
    };

    while line.is_some() {
        // trim this line of code
        let trimmed = line.unwrap().trim();

        // skip empty lines
        if trimmed.is_empty() {
            line = lines.next();
            continue;
        }

        // does this line contain a tag openning
        let tag_open = trimmed.contains(&tag_open_token);
        // should indicate the closing of an open tag
        let tag_close = trimmed.contains(&tag_close_token);
        // for when a component is declared as an unpaired tag
        let unpaired_close = trimmed.contains(&UNPAIRED_TAG_CLOSE_TOKEN);

        let is_unpaired_tag = tag_open
            && !trimmed.contains(UNPAIRED_TAG_CLOSE_TOKEN)
            && !trimmed.contains(&tag_close_token);

        // something line <tag />
        let is_unpaired_inline = tag_open && unpaired_close;
        // something like <tag></tag> in the same line
        let is_paired_inline = tag_open && tag_close;

        if is_unpaired_inline {
            write(&c_html);
            // ok, done!
            return result;
        }

        if is_unpaired_tag {
            let inner_html =
                collect_until_an_end_token(lines, vec![UNPAIRED_TAG_CLOSE_TOKEN, &tag_close_token]);

            let with_filled_slots = fill_component_slots(&c_html, &inner_html);
            write(&with_filled_slots);

            // ok, done!
            return result;
        }

        if is_paired_inline {
            let inner_html = collect_from_to(trimmed, ">", &tag_close_token);
            if !inner_html.is_empty() {
                let with_filled_slots = fill_component_slots(&c_html, &inner_html);
                write(&with_filled_slots);
            } else {
                write(&c_html);
            }

            // ok, done!
            return result;
        }

        write(trimmed);
        // done! move on
        line = lines.next();
    }

    return result;
}

fn get_tag_name_by_token<'t>(line: &'t str, token: &'t str) -> &'t str {
    let mut end_token_i = line.len();
    // based on the tag start token, "<" exists in this line
    let start_i = line.find(token).unwrap();
    // replace close tokens
    let unpaired = line.find(UNPAIRED_TAG_CLOSE_TOKEN);
    let close = line.find(">");
    let space = line.find(" ");

    // end-token is either the end of the line of when it finds one of the tokens
    // " " and ">" and "/", the order of the tokens matter
    let token = vec![space, close, unpaired];

    for tok in token {
        if tok.is_some() {
            end_token_i = tok.unwrap();
            break;
        }
    }

    line.get(start_i + 1..end_token_i).unwrap().trim()
}

fn get_component_name(line: &str) -> &str {
    get_tag_name_by_token(line, COMPONENT_TAG_START_TOKEN)
}

fn get_tag_name(line: &str) -> &str {
    get_tag_name_by_token(line, "<")
}

fn read_code(file: &PathBuf) -> Result<String> {
    let content = read_to_string(file)?;
    Ok(content)
}

/// Takes a string splits it two and joins it with a new slice thus replacing a chunk
fn replace_chunk(source: &String, cut_slice: &str, add_slice: &str) -> String {
    source
        .split(cut_slice)
        .collect::<Vec<&str>>()
        .join(add_slice)
        .trim()
        .to_string()
}

fn parse_component(c_id: &str, c_code: &String, is_nested: bool) -> Result<String> {
    let is_template = c_code.trim().starts_with(TEMPLATE_START_TOKEN);
    let mut result = String::new();

    if !is_template {
        println!(
            "{} Components must be defined as a template tag and have a valid id",
            Emoji::FLAG
        );
        return Ok("".to_string());
    }

    let attrs = get_attrs_inline(c_code, TEMPLATE_START_TOKEN, ">").unwrap_or("");
    let c_inner_html = collect_from_to(&c_code, ">", TEMPLATE_END_TOKEN);

    // ship it if its empty
    if c_inner_html.is_empty() {
        return Ok("".to_string());
    }

    // the result starts as the component inner html
    result.push_str(&c_inner_html);

    let frag_attr = get_attr(attrs, "data-fragment").unwrap_or("false");
    let is_fragment = frag_attr == "true";

    // fragments are not scoped
    let c_scope = if is_fragment {
        None
    } else {
        Some(checksum(&c_inner_html).as_hex)
    };

    let style_start = result.find("<style");
    let style_end_token = "</style>";
    let style_end = result.find(style_end_token);
    let has_style = style_start.is_some() && style_end.is_some();

    let script_start = result.find("<script");
    let script_end_token = "</script>";
    let script_end = result.find(script_end_token);

    let has_script = script_start.is_some() && script_end.is_some();

    if has_style {
        let style_start_i = style_start.unwrap();
        let style_end_i = style_end.unwrap();
        let style_code = result
            .get(style_start_i..style_end_i + style_end_token.len())
            .unwrap_or("");

        result = replace_chunk(&result, style_code, "");
    }

    if has_script {
        let script_start_i = script_start.unwrap();
        let script_end_i = script_end.unwrap();
        let script_code = result
            .get(script_start_i..script_end_i + script_end_token.len())
            .unwrap_or("");

        result = replace_chunk(&result, script_code, "");
    }

    // if the component is a fragment, simply ship the html
    if is_fragment {
        let code = result.trim().to_string();
        return Ok(code);
    }

    // if the component is not a fragment, check for a root element
    if c_scope.is_some() {
        let scope = c_scope.unwrap();
        let rest = result.trim();

        let first_line = rest.lines().next().unwrap_or("");
        let last_line = rest.lines().last().unwrap_or("");

        let tag_name = get_tag_name(first_line);
        // create the end token for this tag
        let tag_start = format!("<{tag_name}");
        let tag_end = format!("</{tag_name}");

        // if the tag end token count is uneven and
        // exists on the last line, its the root node
        let tag_count = rest.matches(&tag_end).count();
        let is_root_node = (tag_count == 1 || tag_count % 2 == 0) && last_line.contains(&tag_end);

        let c_attrs = format!(
            "{DATA_SCOPE_TOKEN}=\"{scope}\"{SP}
        {DATA_NESTED_TOKEN}=\"{is_nested}\"{SP}
        {DATA_COMPONENT_NAME}=\"{c_id}\""
        );

        if !is_root_node {
            let scoped_code = format!("<div{SP}{c_attrs}>{rest}</div>");
            return Ok(scoped_code);
        }

        if is_root_node {
            let attrs = get_attrs_inline(first_line, &tag_start, ">")
                .unwrap_or("")
                .trim();

            let inner_html = collect_from_to(&rest, ">", &tag_end);
            let inner_html = inner_html.trim();

            // add the scope attribute
            let scoped_code = if attrs.is_empty() {
                format!("{tag_start}{SP}{c_attrs}>{NL}{inner_html}{NL}{tag_end}>")
            } else {
                format!("{tag_start}{SP}{attrs}{SP}{c_attrs}>{NL}{inner_html}{NL}{tag_end}>")
            };

            return Ok(scoped_code);
        }
    }

    Ok("".to_string())
}

fn parse_code(code: &String, file: &PathBuf) -> Result<String> {
    let mut lines = code.lines();
    let mut line = lines.next();
    let mut line_number = 0;
    let mut result = String::new();

    let mut templates = HashMap::<&str, String>::new();
    // a component html file
    let is_component = code.trim_start().starts_with(TEMPLATE_START_TOKEN);

    while line.is_some() {
        let pre = line.unwrap();
        line_number.add_assign(1);

        // Write this line to the result string
        let mut write = |line| {
            result.push_str(line);
            result.push_str(NL);
        };

        // before trimming write empty line as is
        if pre.is_empty() {
            write(pre);
            line = lines.next();
            line_number.add_assign(1);
            continue;
        }

        // trim this line of code
        let trimmed = pre.trim();

        let is_inline_link = trimmed.starts_with(LINK_START_TOKEN) && trimmed.contains(">");
        let is_component_link = trimmed.contains("rel=\"component\"") && is_inline_link;
        let is_template_start =
            !is_component && trimmed.starts_with(TEMPLATE_START_TOKEN) && trimmed.contains(">");

        // is a top level comment
        let is_top_comment = trimmed.starts_with(HTML_COMMENT_START_TOKEN);

        // eval commented sections
        if is_top_comment {
            let mut commented_line = trimmed;
            // this is a commented line, write it
            write(commented_line);

            // multiline comment section, if the condition here is false, the loop does not run
            // would be cool to have a do while tho
            while !commented_line.contains(HTML_COMMENT_END_TOKEN) {
                line = lines.next();
                line_number.add_assign(1);
                commented_line = line.unwrap().trim();
                write(commented_line);
            }

            line_number.add_assign(1);
            line = lines.next();
            continue;
        }

        // *** parse in-file component
        if is_template_start {
            let attrs = get_attrs_inline(trimmed, TEMPLATE_START_TOKEN, ">");
            if attrs.is_some() {
                let attrs = attrs.unwrap();
                let c_id = get_attr(attrs, "id").and_then(|v| get_valid_id(v));

                if c_id.is_some() {
                    let inner_html = collect_until_end_token(&mut lines, TEMPLATE_END_TOKEN);
                    let len_as_i32 = inner_html.len().to_string().parse::<i32>()?;

                    let rebuilt_html =
                        format!("{trimmed}{NL}{inner_html}{NL}{TEMPLATE_END_TOKEN}>");
                    let c_html = parse_code(&rebuilt_html, file)?;
                    templates.insert(c_id.unwrap(), c_html);

                    // skip only when a valid component id is found
                    line = lines.next();
                    line_number.add_assign(len_as_i32 + 1);
                    continue;
                }
            }
        }

        // *** parse inline link tag
        if is_component_link {
            let attrs = get_attrs_inline(trimmed, LINK_START_TOKEN, ">");

            if attrs.is_some() {
                let attrs = attrs.unwrap();
                let c_id = get_attr(attrs, "id").and_then(|v| get_valid_id(v));

                let c_url = get_attr(attrs, "href").and_then(|u| evaluate_url(&file, u));
                if c_url.is_some() {
                    let c_html = parse(&c_url.unwrap());
                    if c_html.is_ok() {
                        templates.insert(c_id.unwrap(), c_html.unwrap());
                    }
                }
            }

            line = lines.next();
            line_number.add_assign(1);
            continue;
        }

        let is_component_tag = trimmed.contains(COMPONENT_TAG_START_TOKEN);

        if is_component_tag {
            let c_name = get_component_name(trimmed);
            let file = path::strip_crate_cwd(file);
            let file = file.to_str().unwrap_or("");

            let undefined = |line: i32, col: i32| {
                println!(
                    "{}:{}:{} Undefined static component {} {:?} removed",
                    file,
                    line,
                    col,
                    Emoji::FLAG,
                    c_name
                );
            };

            let entry = templates.get(c_name);
            if entry.is_none() {
                line = lines.next();
                line_number.add_assign(1);
                undefined(line_number, 0);
                continue;
            }

            let c_html = entry.unwrap();
            let parsed_code = parse_component(c_name, c_html, is_component)?;

            let replaced = replace_component_with_static(trimmed, &mut lines, c_name, &parsed_code);

            write(&replaced);
            line = lines.next();
            line_number.add_assign(1);
            continue;
        }

        write(trimmed);
        line = lines.next();
        line_number.add_assign(1);
    }

    Ok(result)
}

// *** INTERFACE ***

pub fn parse(file: &PathBuf) -> Result<String> {
    let code = read_code(&file)?;
    parse_code(&code, &file)
}
