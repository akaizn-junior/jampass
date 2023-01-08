use adler::adler32_slice;
use std::{collections::HashMap, fs::read_to_string, ops::AddAssign, path::PathBuf, str::Lines};

use crate::{
    core_t::{Emoji, Result},
    env,
    util::path,
};

// *** TYPES ***

/// Content checksum Type
struct Checksum {
    as_hex: String,
}

struct Cursor {
    line: i32,
    col: i32,
}

struct Meta<'m> {
    name: &'m str,
    file: PathBuf,
}

struct Proc<'p> {
    meta: Meta<'p>,
    html: String,
}

struct Unlisted<'u> {
    meta: Meta<'u>,
    cursor: Cursor,
}

/// Defines a scoped CSS selector
struct ScopedSelector {
    class: String,
    name: String,
    style_tag_id: String,
    script_tag_id: String,
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

impl ScopedSelector {
    const CLASS_SELECTOR_TOKEN: &'static str = ".";

    fn new(selector: &str, scope: &str) -> Self {
        let default_prefix = "_x_";
        let scoped_selector = format!("{default_prefix}{selector}_{scope}");
        let class = format!("{}{scoped_selector}", Self::CLASS_SELECTOR_TOKEN);
        let style_tag_id = format!("{selector}-{scope}-style");
        let script_tag_id = format!("{selector}-{scope}-script");

        Self {
            class,
            name: scoped_selector,
            style_tag_id,
            script_tag_id,
        }
    }
}

// *** CONSTANTS ***

/// Just the UNIX line separator aka newline (NL)
const NL: &str = "\n";
const STATIC_QUERY_FN_TOKEN: &str = "$query";
const QUERY_FACTORY_TOKEN: &str = "_x_QueryByScope";
const QUERY_FN_NAME: &str = "query";
const DATA_SCOPE_TOKEN: &str = "data-x-scope";
const DATA_NESTED_TOKEN: &str = "data-x-nested";
const DATA_COMPONENT_NAME: &str = "data-x-name";
const HTML_COMMENT_START_TOKEN: &str = "<!--";
const HTML_COMMENT_END_TOKEN: &str = "-->";
const COMPONENT_TAG_START_TOKEN: &str = "<x-";
const CSS_OPEN_RULE_TOKEN: &str = "{";
const CSS_AT_TOKEN: &str = "@";
const COMPONENT_PREFIX_TOKEN: &str = "x-";
/// Space token
const SP: &str = " ";
const JS_CLIENT_CORE_PATH: &str = "src/util/js/client_core.js";
const GLOBAL_SCRIPT_ID: &str = "_x-script";
const GLOBAL_CORE_SCRIPT_ID: &str = "_x-core-script";
const TEMPLATE_START_TOKEN: &str = "<template";
const TEMPLATE_END_TOKEN: &str = "</template";
const LINK_START_TOKEN: &str = "<link";
const UNPAIRED_TAG_CLOSE_TOKEN: &str = "/>";
const BODY_TAG_OPEN: &str = "<body>";

// *** HELPERS ***

fn collect_html_tag(line: &str, lines: &mut Lines, tag_name: &str) -> String {
    let mut result = String::new();
    let end_token = format!("</{tag_name}");

    if !line.is_empty() {
        let pre = line;

        // if its inline, verify if it contains a paired end token or an unpaired end token
        if pre.contains(&end_token) || pre.contains(UNPAIRED_TAG_CLOSE_TOKEN) {
            result.push_str(pre);
            return result;
        }

        let mut current_line = Some(pre);
        let mut next_line = current_line.unwrap();

        while !next_line.contains(&end_token) {
            current_line = lines.next();
            result.push_str(next_line);
            result.push_str(NL);
            next_line = current_line.unwrap();
        }

        // get the very last line aswell
        result.push_str(next_line);
    }

    return result;
}

/// Collects a slice line by line until one of the end tokens is found
/// Returns the result collected until the end token is found
fn collect_until_end_tag<'c>(lines: &'c mut Lines, tag_name: &'c str) -> (i32, String) {
    let mut line = lines.next();
    let mut result = String::new();
    // create the end tag token
    let start_token = format!("<{}", tag_name);
    let end_token = format!("</{}", tag_name);
    // this code will represent 1 if the tag was paired
    // and 0 if it was unpaired
    let mut end_token_code = 1;

    if line.is_some() {
        let pre = line.unwrap();
        let mut next_line = pre;

        // on each iteration calculate if one of the tokens was found
        while !next_line.contains(&end_token) {
            // if somehow this lines contains the start token, skip it
            if next_line.contains(&start_token) {
                line = lines.next();
                next_line = line.unwrap();
                continue;
            }

            // if this tag is unpaired, stop here
            if next_line.trim_start().starts_with(UNPAIRED_TAG_CLOSE_TOKEN) {
                end_token_code = 0;
                break;
            }

            line = lines.next();
            result.push_str(next_line);
            result.push_str(NL);
            next_line = line.unwrap();
        }
    }

    return (end_token_code, result);
}

fn collect_inner_html_inline<'s>(line: &'s str) -> Option<&'s str> {
    let inline_start_token = ">";
    let inline_end_token = "<";
    let slice_len = line.len() - 1;

    let start_i = line.find(inline_start_token).unwrap_or(0);
    let end_i = line
        .get(start_i..)
        .unwrap_or(line)
        .rfind(inline_end_token)
        .unwrap_or(slice_len);

    let end_i = if end_i.eq(&slice_len) {
        slice_len
    } else {
        start_i + end_i
    };

    line.get(start_i + inline_start_token.len()..end_i)
}

fn collect_inner_html<'c>(line: &'c str, lines: &'c mut Lines, tag_name: &'c str) -> String {
    let end_token = format!("</{}", tag_name);
    let mut result = String::new();

    // *** Grab the first line
    let pre = line;
    let is_paired_inline = pre.contains(&end_token);

    // *** if end token found on the first line, consider it done
    if is_paired_inline {
        if let Some(inner_html) = collect_inner_html_inline(pre) {
            result.push_str(inner_html);
            return result;
        }
    }

    let collected = collect_until_end_tag(lines, tag_name);
    result.push_str(NL);
    result.push_str(&collected.1);

    return result;
}

fn collect_component_inner_html<'s>(source: &str) -> String {
    let mut lines = source.lines();
    // *** Grab the first line
    let mut result = String::new();

    // *** Components may have nested components
    // *** so looking for a closng template tag is not enough
    // *** visit every line until the end

    if let Some(pre) = lines.next() {
        let is_paired_inline = pre.contains(TEMPLATE_END_TOKEN);

        // *** if end token found on the first line, consider it done
        if is_paired_inline {
            if let Some(inner_html) = collect_inner_html_inline(pre) {
                result.push_str(inner_html);
                return result;
            }
        }

        // remove the last line
        lines.next_back();
        // move to the next line and get on with it
        // until the end
        let mut line = lines.next();
        while line != None {
            result.push_str(line.unwrap());
            result.push_str(NL);
            line = lines.next();
        }
    }

    return result;
}

fn get_valid_id(slice: &str) -> Option<&str> {
    if slice.trim_start().starts_with(COMPONENT_PREFIX_TOKEN) {
        return Some(slice);
    }
    None
}

fn get_attr<'a>(line: &'a str, token: &'a str) -> Option<&'a str> {
    let id_token = format!("{token}=\"");

    if let Some(start) = line.find(&id_token) {
        let s_i = start + id_token.len();
        // end index in relation to the start index found
        let end_index = line
            .get(s_i..)
            .unwrap_or("")
            .find("\"")
            .unwrap_or(line.len() - 1);

        // recaibrate end index
        let e_i = s_i + end_index;
        return line.get(s_i..e_i);
    }

    None
}

fn get_attrs_inline<'a>(slice: &'a str, start_token: &'a str) -> Option<&'a str> {
    let end_token = ">";

    if let Some(start) = slice.find(&start_token) {
        let start_i = start + start_token.len();
        let end = slice
            .get(start_i..)
            .unwrap_or("")
            .find(end_token)
            .unwrap_or(slice.len() - 1);

        // is either the token index or the end of the string
        let end_i = end + start_i;
        let result = slice.get(start_i..end_i).unwrap_or("");

        if !result.is_empty() {
            return Some(result);
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

    let trimmed = linked_file.trim_start();

    // evaluate if linked starts with this symbol
    if trimmed.starts_with("./") {
        // consider linked to be relative to main
        let relative_href = linked_file.replacen("./", "", 1);
        component_path = cwd.join(file_parent).join(&relative_href);
    }

    // if linked starts with this symbol
    if trimmed.starts_with("/") {
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

    let mut place_lines = placements.lines();
    let named = HashMap::<&str, String>::new();
    let items: (HashMap<&str, String>, Vec<&str>) = (named, vec![]);

    let (named_placements, rest) = placements.lines().fold(items, |mut acc, elem| {
        place_lines.next();

        if elem.contains("slot=") {
            let tag_name = get_tag_name(elem);
            let attrs = get_attrs_inline(elem, tag_name).unwrap_or("");
            let slot_name = get_attr(attrs, "slot").unwrap_or("");
            let elem_html = collect_html_tag(elem, &mut place_lines, tag_name);

            // now save it
            acc.0.insert(slot_name, elem_html);
        } else {
            acc.1.push(elem);
        }
        return acc;
    });

    let mut c_lines = c_code.lines();
    let mut c_line = c_lines.next();

    while c_line.is_some() {
        let pre = c_line.unwrap();
        let is_named_slot = pre.contains("<slot") && pre.contains("name=\"");
        let is_catch_all_slot = pre.contains("<slot") && !pre.contains("name=\"");

        // join all captured lines for the catch all slot
        let catch_all_html = rest.join(NL);

        if is_catch_all_slot {
            let slot_tag_html = collect_html_tag(pre, &mut c_lines, "slot");
            result = replace_chunk(&result, &slot_tag_html, &catch_all_html);
            c_line = c_lines.next();
            continue;
        }

        if is_named_slot {
            let slot_tag_html = collect_html_tag(pre, &mut c_lines, "slot");
            let attrs = get_attrs_inline(pre, "slot").unwrap_or("");
            let slot_name = get_attr(attrs, "name").unwrap_or("");

            if let Some(placement) = named_placements.get(slot_name) {
                // finally replace the slot with the placement
                result = replace_chunk(&result, &slot_tag_html, placement);
                c_line = c_lines.next();
                continue;
            }
        }

        c_line = c_lines.next();
    }

    return result;
}

/// Replaces the static component with the code generated
fn resolve_component(c_line: &str, lines: &mut Lines, c_id: &str, c_html: &String) -> String {
    let ctag_open_token = format!("<{}", c_id);
    let ctag_close_token = format!("</{}", c_id);

    let mut result = String::new();
    let mut line = Some(c_line);

    let mut write = |line| {
        result.push_str(line);
    };

    while line.is_some() {
        let pre = line.unwrap();

        // skip empty lines
        if pre.is_empty() {
            line = lines.next();
            continue;
        }

        // does this line contain a tag openning
        let tag_open = pre.contains(&ctag_open_token);
        // should indicate the closing of an open tag
        let tag_close = pre.contains(&ctag_close_token);
        // for when a component is declared as an unpaired tag
        let unpaired_close = pre.contains(&UNPAIRED_TAG_CLOSE_TOKEN);

        let is_unpaired_tag =
            tag_open && !pre.contains(UNPAIRED_TAG_CLOSE_TOKEN) && !pre.contains(&ctag_close_token);

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
            let end_match = collect_until_end_tag(lines, c_id);
            let unpaired_end_code = 0;
            let paired_end_code = 1;

            if end_match.0.eq(&unpaired_end_code) {
                write(&c_html);
            }

            if end_match.0.eq(&paired_end_code) {
                let inner_html = end_match.1;
                let with_filled_slots = fill_component_slots(&c_html, &inner_html);
                write(&with_filled_slots);
            }

            // ok, done!
            return result;
        }

        if is_paired_inline {
            let inner_html = collect_inner_html_inline(pre);

            if let Some(inner_html) = inner_html {
                if inner_html.is_empty() {
                    write(&c_html);
                    return result;
                }

                let with_filled_slots = fill_component_slots(&c_html, &inner_html);
                write(&with_filled_slots);
            }

            // ok, done!
            return result;
        }

        write(pre);
        // done! move on
        line = lines.next();
    }

    return result;
}

fn get_tag_name_by_token<'t>(line: &'t str, token: &'t str) -> &'t str {
    let line = line.trim();
    let line_len = line.len() - 1;

    // based on the tag start token, "<" exists in this line
    let start_i = line.find(token);

    // *** Assume this is just a text node
    if start_i.is_none() {
        return line;
    }

    // good to go
    let start_i = start_i.unwrap();

    // *** Find a delimiter token for the tag name relative to the start token index
    let match_token = |token: &str| {
        line.get(start_i..)
            .unwrap_or(line)
            .find(token)
            .unwrap_or(line_len)
    };

    let unpaired = match_token(UNPAIRED_TAG_CLOSE_TOKEN);
    let close = match_token(">");
    let space = match_token(SP);

    // *** end-token is either the end of the line of when it finds one of the tokens
    // *** " " and ">" and "/"
    let tokens = vec![space, close, unpaired];
    // *** find the index of the closest end token found to the start index
    let closest_token_i = tokens.into_iter().fold(line_len, |acc, tok| tok.min(acc));

    // is either a different end token index or the length of the line
    let end_token_i = if closest_token_i.eq(&line_len) {
        line_len
    } else {
        // tokens are found relative to the start index, recalibrate here
        // so its in relation to the entire line
        start_i + closest_token_i
    };

    return line.get(start_i + 1..end_token_i).unwrap();
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

fn no_cwd_path_as_str(file: &PathBuf) -> &str {
    let file = path::strip_crate_cwd(file);
    file.to_str().unwrap_or("")
}

fn is_text_node(source: &str) -> bool {
    let mut lines = source.trim_start().lines();
    let first_line = lines.next().unwrap_or("");
    let tag_name_top = get_tag_name(first_line);
    // if the supposed tag name is equal to the first_line
    // we can assume this is a text node
    tag_name_top.eq(first_line)
}

/// Checks the source code for a root node
fn has_root_node(source: &str) -> bool {
    if source.is_empty() {
        return false;
    }

    let mut lines = source.trim_start().lines();
    let first_line = lines.next().unwrap_or("");
    let tag_name_top = get_tag_name(first_line);
    let last_line = lines.next_back().unwrap_or("");

    // if its a text node, no root found
    if is_text_node(source) {
        return false;
    }

    let tag_end = format!("</{tag_name_top}");
    // if the tag end token count is uneven and
    // exists on the last line, its the root node
    let tag_count = source.matches(&tag_end).count();
    (tag_count == 1 || tag_count % 2 == 0) && last_line.contains(&tag_end)
}

/// Takes a string splits it two and joins it with a new slice thus replacing a chunk
fn replace_chunk(source: &str, cut_slice: &str, add_slice: &str) -> String {
    source
        .split(cut_slice)
        .collect::<Vec<&str>>()
        .join(add_slice)
        .trim()
        .to_string()
}

fn transform_css(code: &str, c_id: &str, scope: &str) -> String {
    let mut result = String::new();

    for line in code.lines() {
        if line.is_empty() {
            continue;
        }

        if line.contains("<style") {
            let style_tag_id = ScopedSelector::new(c_id, scope).style_tag_id;
            let with_id = format!("{NL}<style id=\"{style_tag_id}\">");
            result.push_str(&with_id);
            continue;
        }

        if line.contains("</style") {
            result.push_str("</style>");
            continue;
        }

        let at_selector = line.starts_with(CSS_AT_TOKEN);
        let has_open_token = line.contains(CSS_OPEN_RULE_TOKEN);

        // if this line does not contain the open selector token
        // use the end of the line as the cap to read the selector from
        let selector_end_i = line.find(CSS_OPEN_RULE_TOKEN).unwrap_or(line.len());
        let selector = line.get(..selector_end_i).unwrap_or("").trim();

        // verify the selector validity
        let is_valid_selector = !at_selector
            && !selector.contains(":")
            && !selector.contains("}")
            && !selector.contains(";")
            && !selector.contains(CSS_OPEN_RULE_TOKEN);

        if is_valid_selector && !scope.is_empty() {
            let open_token = if has_open_token {
                CSS_OPEN_RULE_TOKEN
            } else {
                ""
            };

            let scoped_class = ScopedSelector::new(selector, scope).class;
            let scoped_selector = format!("{NL}{scoped_class}{SP}{open_token}{NL}");

            result.push_str(&scoped_selector);
            continue;
        }

        result.push_str(line);
        result.push_str(NL);
    }

    result
}

/// Transforms client bound static functions
fn transform_static_fns(code: &str, scope: &str) -> (String, String) {
    let mut src_code = String::new();
    src_code.push_str(code);

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

fn transform_script(code: &str, c_id: &str, scope: &str) -> String {
    let mut result = String::new();
    let collected = collect_until_end_tag(&mut code.lines(), "script");
    let code = collected.1;

    let script_tag_id = ScopedSelector::new(c_id, scope).script_tag_id;

    let with_id =
        format!("{NL}<script id=\"{script_tag_id}\" data-namespace=\"{GLOBAL_SCRIPT_ID}\">");

    if !scope.is_empty() {
        // define the component's scoped function
        let scoped_fn_definition = format!("function x_{}()", scope);
        // evaluate all static functions
        let (scoped_fns, src_code) = transform_static_fns(&code, scope);

        let scoped = format!(
            "{NL}({}{SP}{{{}{NL}{}}})();",
            scoped_fn_definition,
            scoped_fns,
            src_code.trim()
        );

        result.push_str(&with_id);
        result.push_str(&scoped);
        result.push_str(NL);
        result.push_str("</script>");
        return result;
    }

    format!("{with_id}{NL}{{{NL}{}{NL}}}{NL}</script>", code.trim())
}

fn add_core_script(source: &str) -> Result<String> {
    let pkg_cwd = env::crate_cwd();
    let file = pkg_cwd.join(JS_CLIENT_CORE_PATH);
    let code = read_code(&file);

    let namespace = format!("data-namespace=\"{GLOBAL_SCRIPT_ID}\"");

    // if namespace exists
    if source.contains(&namespace) {
        let core = format!(
            "{}<script id=\"{GLOBAL_CORE_SCRIPT_ID}\">{NL}{}</script>",
            BODY_TAG_OPEN,
            code.unwrap()
        );

        let result = replace_chunk(&source, BODY_TAG_OPEN, &core);
        return Ok(result);
    }

    Ok(String::from(source))
}

fn scope_inner_html(code: &str, scope: &str) -> String {
    let mut result = String::new();
    let mut lines = code.lines();
    let mut line = lines.next();

    while line.is_some() {
        let pre = line.unwrap();

        if pre.is_empty() {
            line = lines.next();
            continue;
        }

        if !is_text_node(pre) {
            let tag_name = get_tag_name(pre);
            let start_token = format!("<{tag_name}");
            let inner_html = collect_inner_html(pre, &mut lines, tag_name);

            // get the class attributes
            let attrs = get_attrs_inline(pre, &start_token).unwrap_or("");
            let class_attr_value = get_attr(attrs, "class");
            // create the scoped class name
            let mut scoped_class = ScopedSelector::new(tag_name, scope).name;
            // if attributes indicate that an element is a component, handle it accordingly
            // scoped selectors for inner components may not clash with the parent component
            let c_name_attr = get_attr(pre, "data-x-name");

            if let Some(value) = c_name_attr {
                let c_name_with_underscores = value.replace("-", "_");
                let c_name_with_underscores = format!("_{c_name_with_underscores}_{tag_name}");
                scoped_class = ScopedSelector::new(&c_name_with_underscores, scope).name;
            }

            if let Some(value) = class_attr_value {
                let mut class_list = String::from(value);
                // first remove the old class list from the list of attributes
                let old_list = format!("class=\"{class_list}\"");
                let attrs = attrs.replace(&old_list, "");

                // append the new scoped class to the existing list of classes
                class_list.push_str(SP);
                class_list.push_str(&scoped_class);
                // append the new class list to the list of attributes
                let new_attrs = format!("{}{SP}class=\"{class_list}\"", attrs.trim());

                let tag = format!("{start_token}{SP}{new_attrs}>{inner_html}</{tag_name}>");
                result.push_str(&tag);
                result.push_str(NL);
            } else {
                // append the new class list to the list of attributes
                let scoped_class = scoped_class.trim();
                let attrs = attrs.trim();

                let new_attrs = if attrs.is_empty() {
                    format!("class=\"{scoped_class}\"")
                } else {
                    format!("class=\"{scoped_class}\"{SP}{attrs}")
                };

                let tag = format!("{start_token}{SP}{new_attrs}>{inner_html}</{tag_name}>");
                result.push_str(&tag);
                result.push_str(NL);
            }

            line = lines.next();
            continue;
        }

        result.push_str(pre);
        result.push_str(NL);
        line = lines.next();
    }

    result
}

fn transform_component(
    file: &PathBuf,
    c_id: &str,
    c_code: &String,
    is_nested: bool,
) -> Result<String> {
    let code = c_code.trim_start();
    let is_template_tag = code.starts_with(TEMPLATE_START_TOKEN);

    if !is_template_tag {
        println!(
            "{} {} Components must be defined as a template tag",
            no_cwd_path_as_str(file),
            Emoji::FLAG
        );
        return Ok("".to_string());
    }

    let attrs = get_attrs_inline(code, TEMPLATE_START_TOKEN).unwrap_or("");
    let c_inner_html = collect_component_inner_html(&code);
    let frag_attr = get_attr(attrs, "data-fragment").unwrap_or("false");
    let is_fragment = frag_attr == "true";

    // fragments are not scoped
    let c_scope = if is_fragment {
        "".to_string()
    } else {
        checksum(&c_inner_html).as_hex
    };

    // ship it if its empty
    if c_inner_html.is_empty() {
        return Ok("".to_string());
    }

    let mut tags = String::new();
    tags.push_str(&c_inner_html);

    let mut parsed_css_and_script = String::new();

    let style_start = c_inner_html.find("<style");
    let style_end_token = "</style>";
    let style_end = c_inner_html.find(style_end_token);
    let has_style = style_start.is_some() && style_end.is_some();

    let script_start = c_inner_html.find("<script");
    let script_end_token = "</script>";
    let script_end = c_inner_html.find(script_end_token);

    let has_script = script_start.is_some() && script_end.is_some();

    if has_style {
        let style_start_i = style_start.unwrap();
        let style_end_i = style_end.unwrap();

        let style_code = c_inner_html
            .get(style_start_i..style_end_i + style_end_token.len())
            .unwrap_or("");

        let parsed = transform_css(style_code, c_id, &c_scope);
        parsed_css_and_script.push_str(&parsed);
        tags = replace_chunk(&tags, style_code, "");
    }

    if has_script {
        let script_start_i = script_start.unwrap();
        let script_end_i = script_end.unwrap();

        let script_code = c_inner_html
            .get(script_start_i..script_end_i + script_end_token.len())
            .unwrap_or("");

        let parsed = transform_script(script_code, c_id, &c_scope);
        parsed_css_and_script.push_str(&parsed);
        tags = replace_chunk(&tags, script_code, "");
    }

    // if the component is a fragment, simply ship the html
    if is_fragment {
        return Ok(tags);
    }

    // if the component is not a fragment, check for a root element
    if !is_fragment {
        let rest = tags;

        let first_line = rest.lines().next().unwrap_or("");
        let has_root_node = has_root_node(&rest);

        let c_attrs = format!(
            "{}=\"{c_scope}\"{SP}{}=\"{is_nested}\"{SP}{}=\"{c_id}\"",
            DATA_SCOPE_TOKEN, DATA_NESTED_TOKEN, DATA_COMPONENT_NAME
        );

        if !has_root_node {
            let scoped_code = format!("<div{SP}{c_attrs}>{rest}</div>{parsed_css_and_script}");
            return Ok(scoped_code);
        }

        if has_root_node {
            let tag_name_top = get_tag_name(first_line);
            // create the end token for this tag
            let tag_start = format!("<{tag_name_top}");
            let tag_end = format!("</{tag_name_top}");

            let attrs = get_attrs_inline(first_line, &tag_start).unwrap_or("");
            let inner_html = collect_component_inner_html(&rest);
            let inner_html = inner_html.trim();

            // scope every element
            let inner_scopped = scope_inner_html(inner_html, &c_scope);

            // add the scope attribute
            let scoped_code = if attrs.is_empty() {
                format!("{tag_start}{SP}{c_attrs}>{NL}{inner_scopped}{NL}{tag_end}>{parsed_css_and_script}")
            } else {
                format!("{tag_start}{SP}{attrs}{SP}{c_attrs}>{NL}{inner_scopped}{NL}{tag_end}>{parsed_css_and_script}")
            };

            return Ok(scoped_code);
        }
    }

    Ok("".to_string())
}

// *** INTERFACE ***

pub fn transform(code: &String, file: &PathBuf) -> Result<TransformOutput> {
    let code = code.trim_start();
    let mut lines = code.lines();
    let mut line = lines.next();
    let mut line_number = 0;
    let mut result = String::new();

    let mut processed = HashMap::<&str, Proc>::new();
    // same as processed except items are removed from this map once used properly
    let mut unlisted = HashMap::<&str, Unlisted>::new();
    // a list of all linked items to this file
    let mut linked_list = Vec::<Linked>::new();

    // is a component html file
    let is_component = code.starts_with(TEMPLATE_START_TOKEN);

    fn undefined(msg: &str, data: &Unlisted) {
        println!(
            "{}:{}:{} {msg} {} {:?} removed",
            no_cwd_path_as_str(&data.meta.file),
            data.cursor.line,
            data.cursor.col,
            Emoji::FLAG,
            data.meta.name
        );
    }

    while line.is_some() {
        let pre = line.unwrap();
        line_number.add_assign(1);

        // Write this line to the result string
        let mut write = |line| {
            result.push_str(line);
            result.push_str(NL);
        };

        // write empty lines as is
        if pre.is_empty() {
            write(pre);
            line = lines.next();
            continue;
        }

        let is_linked_rel = pre.contains("rel=");
        let is_linked_src = pre.contains("src=");
        let is_linked_component = pre.contains("rel=\"component\"");

        if is_linked_rel {
            let path = get_attr(pre, "href");

            if let Some(p) = path {
                let asset = evaluate_url(file, p).unwrap_or_default();
                // add to the list of linked items
                linked_list.push(Linked {
                    file: file.to_owned(),
                    asset,
                    is_component: is_linked_component,
                })
            }
        }

        if is_linked_src {
            let path = get_attr(pre, "src");

            if let Some(p) = path {
                let asset = evaluate_url(file, p).unwrap_or_default();
                // add to the list of linked items
                linked_list.push(Linked {
                    file: file.to_owned(),
                    asset,
                    is_component: is_linked_component,
                })
            }
        }

        let trimmed = pre.trim();

        let is_inline_link = trimmed.starts_with(LINK_START_TOKEN) && trimmed.contains(">");
        let is_component_link = trimmed.contains("rel=\"component\"") && is_inline_link;
        let is_inner_template =
            line_number > 1 && trimmed.starts_with(TEMPLATE_START_TOKEN) && trimmed.contains(">");

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
                commented_line = line.unwrap();
                write(commented_line);
            }

            line = lines.next();
            continue;
        }

        // *** parse in-file component
        if is_inner_template {
            if let Some(attrs) = get_attrs_inline(trimmed, TEMPLATE_START_TOKEN) {
                let c_id = get_attr(attrs, "id").and_then(|v| get_valid_id(v));

                if c_id.is_none() {
                    println!(
                        "Component {} does not have a valid id. ignored",
                        Emoji::COMPONENT
                    );

                    line = lines.next();
                    continue;
                }

                let c_id = c_id.unwrap();
                let c_html = collect_html_tag(trimmed, &mut lines, "template");

                let len_as_i32 = c_html.len().to_string().parse::<i32>()?;
                line_number.add_assign(len_as_i32);

                let mut parsed = transform(&c_html, file)?;
                // append to the current linked list
                linked_list.append(&mut parsed.linked_list);

                let c_html = parsed.code;

                let data = Proc {
                    meta: Meta {
                        name: c_id,
                        file: file.to_owned(),
                    },
                    html: c_html,
                };

                processed.insert(c_id, data);
                unlisted.insert(
                    c_id,
                    Unlisted {
                        meta: Meta {
                            name: c_id,
                            file: file.to_owned(),
                        },
                        cursor: Cursor {
                            line: line_number,
                            col: 0,
                        },
                    },
                );

                // skip only when a valid component id is found
                line = lines.next();
                continue;
            }
        }

        // *** parse inline link tag
        if is_component_link {
            if let Some(attrs) = get_attrs_inline(trimmed, LINK_START_TOKEN) {
                let c_id = get_attr(attrs, "id").and_then(|v| get_valid_id(v));

                if c_id.is_none() {
                    println!(
                        "Linked component {} does not have a valid id. ignored",
                        Emoji::LINK
                    );

                    line = lines.next();
                    continue;
                }

                let c_id = c_id.unwrap();
                let c_url = get_attr(attrs, "href").and_then(|u| evaluate_url(&file, u));

                if let Some(c_file) = c_url {
                    let code = read_code(&c_file)?;
                    let mut parsed = transform(&code, &c_file)?;
                    // append to the current linked list
                    linked_list.append(&mut parsed.linked_list);

                    let c_html = parsed.code;

                    let data = Proc {
                        meta: Meta {
                            name: c_id,
                            file: c_file.to_owned(),
                        },
                        html: c_html,
                    };

                    processed.insert(c_id, data);
                    unlisted.insert(
                        c_id,
                        Unlisted {
                            meta: Meta {
                                name: c_id,
                                file: c_file.to_owned(),
                            },
                            cursor: Cursor {
                                line: line_number,
                                col: 0,
                            },
                        },
                    );
                }
            }

            line = lines.next();
            continue;
        }

        // the default values here dont matter, they are set so that we can unwrap the values in place
        // its all good as long as the component index is less than the comment index
        let component_index = trimmed.find(COMPONENT_TAG_START_TOKEN).unwrap_or(0);
        let comment_index = trimmed.find(HTML_COMMENT_START_TOKEN).unwrap_or(1);

        // obvs only process components not comments
        let is_component_tag =
            trimmed.contains(COMPONENT_TAG_START_TOKEN) && component_index < comment_index;

        if is_component_tag {
            let c_name = get_component_name(trimmed);
            let entry = processed.get(c_name);

            if entry.is_none() {
                line = lines.next();

                let data = Unlisted {
                    meta: Meta {
                        name: c_name,
                        file: file.to_owned(),
                    },
                    cursor: Cursor {
                        line: line_number,
                        col: 0,
                    },
                };

                undefined("Undefined component", &data);
                continue;
            }

            let data = entry.unwrap();

            let parsed_code =
                transform_component(&data.meta.file, data.meta.name, &data.html, is_component)?;
            let resolved = resolve_component(trimmed, &mut lines, c_name, &parsed_code);

            // remove from unlisted
            unlisted.remove_entry(c_name);

            write(&resolved);
            line = lines.next();
            continue;
        }

        write(trimmed);
        line = lines.next();
    }

    // log left-over items
    for entry in unlisted {
        undefined("Unused component", &entry.1);
    }

    let with_core = add_core_script(&result)?;

    Ok(TransformOutput {
        linked_list,
        code: with_core,
    })
}
