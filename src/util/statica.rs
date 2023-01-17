use adler::adler32_slice;
use std::{
    collections::HashMap,
    fs::read_to_string,
    iter::Peekable,
    ops::AddAssign,
    path::PathBuf,
    str::{Chars, Lines},
};

use crate::{
    core_t::{Colors, Emoji, Result},
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

struct Meta {
    name: String,
    file: PathBuf,
}

/// Processed
struct Proc {
    meta: Meta,
    html: String,
    /// keeps count of how may times a component is rendered
    usage: i32,
}

impl Proc {
    fn inc_usage(&mut self, value: i32) {
        self.usage.add_assign(value);
    }
}

struct Unlisted {
    meta: Meta,
    cursor: Cursor,
    html: String,
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
struct ScopedSelector {
    class: String,
    name: String,
}

impl ScopedSelector {
    const CLASS_SELECTOR_TOKEN: &'static str = ".";
    const INFIX: &'static str = "_x_";

    fn new(selector: &str, scope: &str) -> Self {
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

    fn is_scoped(slice: &str) -> bool {
        let item = slice.split(Self::INFIX);
        let has_scope = item.count() > 1;
        has_scope
    }
}

#[derive(Debug, PartialEq, Clone)]
struct Prop {
    name: String,
    default: Option<String>,
    value: Option<String>,
    /// a list of ways a prop can be used
    templates: Vec<String>,
}

impl Prop {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            default: None,
            value: None,
            templates: vec![
                format!("(\"{}\")", name.to_string()),
                format!("(\'{}\')", name.to_string()),
                format!("--{}", name.to_string()),
            ],
        }
    }

    fn default_mut(&mut self) -> &mut Option<String> {
        &mut self.default
    }

    fn value_mut(&mut self) -> &mut Option<String> {
        &mut self.value
    }

    fn to_string(&self) -> String {
        format!(
            "{}=\"{}\"{SP}",
            self.name,
            self.value.as_ref().unwrap_or(&"".to_string())
        )
    }
}

/// A dict for component props
type PropMap = HashMap<String, Prop>;

// *** CONSTANTS ***

/// Just the UNIX line separator aka newline (NL)
const NL: &str = "\n";
const STATIC_QUERY_FN_TOKEN: &str = "$find";
const QUERY_FACTORY_TOKEN: &str = "_x_QueryByScope";
const QUERY_FN_NAME: &str = "find";
const DATA_SCOPE_TOKEN: &str = "data-x-scope";
const DATA_NESTED_TOKEN: &str = "data-x-nested";
const DATA_COMPONENT_NAME: &str = "data-x-name";
const DATA_COMPONENT_INSTANCE: &str = "data-x-instance";
const HTML_COMMENT_START_TOKEN: &str = "<!--";
const HTML_COMMENT_END_TOKEN: &str = "-->";
const COMPONENT_TAG_START_TOKEN: &str = "<x-";
const CSS_OPEN_RULE_TOKEN: &str = "{";
const CSS_AT_TOKEN: &str = "@";
const COMPONENT_PREFIX_TOKEN: &str = "x-";
/// Space token
const SP: &str = " ";
const JS_CLIENT_CORE_PATH: &str = "src/util/js/client_core.js";
const GLOBAL_SCRIPT_ID: &str = "_x_script";
const GLOBAL_CSS_ID: &str = "_x_style";
const GLOBAL_CORE_SCRIPT_ID: &str = "_x_core_script";
const TEMPLATE_START_TOKEN: &str = "<template";
const TEMPLATE_END_TOKEN: &str = "</template";
const LINK_START_TOKEN: &str = "<link";
const UNPAIRED_TAG_CLOSE_TOKEN: &str = "/>";
const BODY_TAG_OPEN: &str = "<body>";

// *** HELPERS ***

fn consume_chars_while(chars: &mut Peekable<Chars>, condition: fn(char) -> bool) -> Option<String> {
    let mut consumed = String::new();
    while chars.peek().map_or(false, |&c| condition(c)) {
        consumed.push(chars.next().unwrap());
    }

    (!consumed.is_empty()).then_some(consumed)
}

fn consume_lines_while(
    lines: &mut Peekable<Lines>,
    end_token: &str,
    condition: fn(&str, &str) -> bool,
) -> Option<String> {
    let mut consumed = String::new();
    while lines.peek().map_or(false, |&s| condition(s, end_token)) {
        if let Some(line) = lines.next() {
            consumed.push_str(line);
        }
        consumed.push_str(NL);
    }

    (!consumed.is_empty()).then_some(consumed)
}

fn consume_tag_html(pre: &str, lines: &mut Lines, tag_name: &str) -> String {
    let end_token = format!("</{tag_name}");

    // if its inline, verify if it contains a paired end token or an unpaired end token
    if pre.contains(&end_token) || pre.contains(UNPAIRED_TAG_CLOSE_TOKEN) {
        return pre.to_string();
    }

    let mut result = String::from(pre);
    result.push_str(NL);

    let mut next = lines.next();

    while !next.unwrap_or(&end_token).contains(&end_token) {
        result.push_str(next.unwrap());
        result.push_str(NL);
        next = lines.next();
    }

    // add the end token then ship it
    result.push_str(&end_token);

    return result;
}

/// Reads code that reprensents a component usage line by line until an end token is found
fn consume_until_end_token(lines: &mut Lines, c_id: &str) -> (i32, String) {
    let mut result = String::new();
    // create the end-tag-token to match
    let end_token = format!("</{}", c_id);
    // the end code is 1 if the tag was paired
    // or 0 if it was unpaired
    let mut end_token_code = 1;

    // now, peekable lines
    let mut lines = lines.peekable();

    while lines.peek().map_or(false, |&line| {
        let trimmed = line.trim_start();
        if trimmed.contains(UNPAIRED_TAG_CLOSE_TOKEN) {
            end_token_code = 0;
            return false;
        }
        !trimmed.starts_with(&end_token)
    }) {
        if let Some(line) = lines.next() {
            result.push_str(line);
        }
        result.push_str(NL);
    }

    return (end_token_code, result);
}

fn consume_inner_content(lines: &mut Peekable<Lines>) -> String {
    // skip the top line
    lines.next();
    // skip the bottom line
    lines.next_back();
    // consume the rest
    let content = consume_lines_while(lines, "", |s, _| s != NL);
    content.unwrap_or_default()
}

fn consume_inner_html_inline<'s>(line: &'s str) -> Option<String> {
    let inline_start_token = ">";
    let start_i = line.find(inline_start_token).unwrap_or(0);
    let mut chars = line.get(start_i..).unwrap_or(line).chars().peekable();
    // consume until the inline end token
    return consume_chars_while(&mut chars, |c| c != '<');
}

fn consume_component_inner_html<'s>(source: &str) -> String {
    let mut lines = source.lines().peekable();
    let mut result = String::new();

    // *** Components may have nested components
    // *** so looking for a closng template tag is not enough
    // *** visit every line until the end

    if let Some(pre) = lines.peek() {
        let is_paired_inline = pre.contains(TEMPLATE_END_TOKEN);

        // *** if end token found on the first line, consider it done
        if is_paired_inline {
            if let Some(inner_html) = consume_inner_html_inline(pre) {
                result.push_str(&inner_html);
                return result;
            }
        }

        // *** consume until the end
        let content = consume_inner_content(&mut lines);
        result.push_str(&content);
    }

    return result;
}

fn get_valid_id(slice: &String) -> Option<String> {
    // starts with valid token
    if slice.trim_start().starts_with(COMPONENT_PREFIX_TOKEN)
    // is at least longer than the token length
        && slice.len() > COMPONENT_PREFIX_TOKEN.len()
    {
        return Some(slice.to_owned());
    }
    None
}

fn get_attrs_inline(line: &str) -> PropMap {
    let tag_name = get_tag_name(line).unwrap_or_default();
    let start_token = format!("<{tag_name}");
    // remove the start token from the line, so only actual attributes are consumed
    let line = line.replace(&start_token, "");
    let mut chars = line.trim_start().chars().peekable();
    let attrs = consume_chars_while(&mut chars, |c| c != '>');

    get_tag_attrs(attrs.as_ref())
}

/// Generates a checksum as an Hex string from a string slice.
fn checksum(slice: &str) -> Checksum {
    let as_u32 = adler32_slice(slice.as_bytes());
    let as_hex = format!("{:x}", as_u32);

    return Checksum { as_hex };
}

/// Evaluates the url of a linked file relative to the entry file or the CWD
fn evaluate_url(entry_file: &PathBuf, linked_path: &str) -> Option<PathBuf> {
    if linked_path.is_empty() {
        return None;
    }

    let cwd = env::current_dir();
    // path base
    let file_endpoint = path::strip_cwd(entry_file);
    // get the parent folder of the main entry file
    // so linked items are fetched relative to the right place
    let file_parent = file_endpoint.parent().unwrap();
    // consider all linked paths to be relative to the main entry
    let asset_path = cwd.join(file_parent).join(&linked_path);

    let trimmed = linked_path.trim_start();

    // evaluate if linked starts with this symbol
    if trimmed.starts_with("./") {
        // consider linked to be relative to main
        let relative_href = linked_path.replacen("./", "", 1);
        return Some(cwd.join(file_parent).join(&relative_href));
    }

    // if linked starts with this symbol
    if trimmed.starts_with("/") {
        // consider linked to be an absolute path, relative to the CWD
        let absolute_href = linked_path.replacen("/", "", 1);
        return Some(cwd.join(&absolute_href));
    }

    Some(asset_path)
}

/// Replaces component slots with their placements
fn fill_component_slots(c_code: &String, placements: &str) -> String {
    let mut result = String::new();
    result.push_str(c_code);

    let mut lines = placements.lines();

    // a dict for all named placements
    let mut named = HashMap::<String, String>::new();
    // the rest
    let mut rest = Vec::<&str>::new();

    // *** Collect placements

    let mut line = lines.next();
    while line.is_some() {
        let elem = line.unwrap();

        if elem.contains("slot=") {
            let tag_name = get_tag_name(elem).unwrap();
            let attrs = get_attrs_inline(elem);

            if let Some(attr) = attrs.get("slot") {
                let elem_html = consume_tag_html(elem, &mut lines, &tag_name);
                let value = attr.value.to_owned().unwrap_or_default();
                named.insert(value, elem_html);
            }
        } else {
            rest.push(elem);
        }

        line = lines.next();
    }

    // *** Fill component slots

    let mut lines = c_code.lines();
    let mut line = lines.next();

    while line.is_some() {
        let elem = line.unwrap();
        let is_named = elem.contains("<slot") && elem.contains("name=\"");
        let is_catch_all = elem.contains("<slot") && !elem.contains("name=\"");

        // join all captured lines for the catch all slot
        let catch_all_html = rest.join(NL);

        if is_catch_all {
            let slot_tag_html = consume_tag_html(elem, &mut lines, "slot");
            result = replace_chunk(&result, &slot_tag_html, &catch_all_html);
            line = lines.next();
            continue;
        }

        if is_named {
            let slot_tag_html = consume_tag_html(elem, &mut lines, "slot");
            let attrs = get_attrs_inline(elem);
            let name_attr = attrs.get("name").unwrap();
            let name_attr_value = name_attr.value.to_owned().unwrap_or_default();

            if let Some(placement) = named.get(&name_attr_value) {
                // finally replace the slot with the placement
                result = replace_chunk(&result, &slot_tag_html, placement);
                line = lines.next();
                continue;
            }
        }

        line = lines.next();
    }

    return result;
}

/// Replaces the static component with the code generated
fn resolve_component(pre: &str, lines: &mut Lines, c_id: &str, c_html: &String) -> String {
    let ctag_open_token = format!("<{}", c_id);
    let ctag_close_token = format!("</{}", c_id);

    let mut result = String::new();

    let mut write = |line| {
        result.push_str(line);
    };

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
        let end_match = consume_until_end_token(lines, c_id);
        const UNPAIRED_CODE: i32 = 0;
        const PAIRED_CODE: i32 = 1;

        if end_match.0.eq(&UNPAIRED_CODE) {
            write(&c_html);
        }

        if end_match.0.eq(&PAIRED_CODE) {
            let inner_html = end_match.1;
            let with_filled_slots = fill_component_slots(&c_html, &inner_html);
            write(&with_filled_slots);
        }

        // ok, done!
        return result;
    }

    if is_paired_inline {
        let inner_html = consume_inner_html_inline(pre);

        if let Some(inner_html) = inner_html {
            // no inner html, ship it
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
    return result;
}

/// The tag name is a ASCII string that may contain dashes
fn get_tag_name(line: &str) -> Option<String> {
    if line.is_empty() {
        return None;
    }

    let line = line.trim();
    let mut chars = line.chars().peekable();
    let char = chars.next();

    if let Some(c) = char {
        // the first char should be the token "<"
        if c == '<' {
            // the next char should not be [whitespace or ! or - or /]
            let next = chars.peek();

            if next.is_none() {
                return None;
            }

            let nch = next.unwrap();
            if nch.is_whitespace() || nch == &'!' || nch == &'-' || nch == &'/' {
                return None;
            }

            // consume while char is a ASCII digit or a '-'
            if let Some(tag_name) = consume_chars_while(&mut chars, |c| c.is_digit(36) || c == '-')
            {
                return Some(tag_name);
            }
        }
    }

    None
}

fn read_file(file: &PathBuf) -> Result<String> {
    let content = read_to_string(file)?;
    Ok(content)
}

fn no_cwd_path_as_str(file: &PathBuf) -> &str {
    let file = path::strip_crate_cwd(file);
    file.to_str().unwrap_or("")
}

/// is a text node if there is not tag name
fn is_text_node(source: &str) -> bool {
    let mut lines = source.trim_start().lines();
    let tag_name = get_tag_name(lines.next().unwrap_or(""));
    tag_name.is_none()
}

/// Checks the source code for a root node
fn has_root_node(source: &str) -> bool {
    // no root found, if its a text node or empty
    if source.is_empty() || is_text_node(source) {
        return false;
    }

    let mut lines = source.trim_start().lines();
    let top = lines.next().unwrap_or("");
    let last = lines.next_back().unwrap_or("");

    let tag_name = get_tag_name(top);

    if tag_name.is_none() {
        return false;
    }

    let tag_name = tag_name.unwrap();

    let tag_end = format!("</{tag_name}");
    // if the tag end token count is uneven and
    // exists on the last line, its the root node
    let tag_count = source.matches(&tag_end).count();
    (tag_count == 1 || tag_count % 2 == 0) && last.contains(&tag_end)
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

fn transform_css(code: &str, scope: &str) -> String {
    let mut result = String::new();

    for line in code.lines() {
        if line.is_empty() {
            continue;
        }

        if line.contains("<style") {
            let with_id = format!("{NL}<style data-namespace=\"{GLOBAL_CSS_ID}\">");
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

        // no need to scope IDs
        let is_id = is_valid_selector && selector.starts_with("#");

        if is_valid_selector && !scope.is_empty() && !is_id {
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
fn transform_static_fns(code: &str, scope: &str, instance: i32) -> (String, String) {
    let mut src_code = String::new();
    src_code.push_str(code);

    let mut scoped_fns = String::new();

    // **** Define scoped functions

    let scoped_query_fn_name = format!("{}_{}", QUERY_FN_NAME, scope);
    let scoped_query_fn = format!(
        "function {}(sel) {{ return {}(sel, {:?}, {}); }}",
        scoped_query_fn_name, QUERY_FACTORY_TOKEN, scope, instance
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

fn transform_script(code: &str, scope: &str, instance: i32) -> String {
    let mut result = String::new();
    let lines = &mut code.lines().peekable();
    let code = consume_inner_content(lines);
    let with_namespace = format!("{NL}<script data-namespace=\"{GLOBAL_SCRIPT_ID}\">");

    if !scope.is_empty() {
        // define the component's scoped function
        let scoped_fn_definition = format!("function x_{}()", scope);
        // evaluate all static functions
        let (scoped_fns, src_code) = transform_static_fns(&code, scope, instance);

        let scoped = format!(
            "{NL}({}{SP}{{{}{NL}{}}})();",
            scoped_fn_definition,
            scoped_fns,
            src_code.trim()
        );

        result.push_str(&with_namespace);
        result.push_str(&scoped);
        result.push_str(NL);
        result.push_str("</script>");
        return result;
    }

    format!("{with_namespace}{NL}{{{NL}{}{NL}}}{NL}</>", code.trim())
}

fn add_core_script(source: &str) -> Result<String> {
    let pkg_cwd = env::crate_cwd();
    let file = pkg_cwd.join(JS_CLIENT_CORE_PATH);
    let code = read_file(&file);

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

fn transform_attrs_with_scope(line: &str, tag_name: String, scope: &str) -> String {
    let start_token = format!("<{tag_name}");
    let end_tok_i = line.find(">").unwrap_or(line.len() - 1);
    // get current attrs
    let mut attrs = get_attrs_inline(line);

    let class_attr = attrs.get("class");
    let tag_name = get_tag_name(line);

    if let Some(class) = class_attr {
        let class_attr_value = class.value.to_owned().unwrap_or_default();
        let tag_name = tag_name.unwrap();

        // skip already scoped classes
        if let Some(classname) = class_attr_value.split(SP).peekable().peek() {
            if ScopedSelector::is_scoped(classname) {
                return line.to_string();
            }
        }

        let mut class_list = class_attr_value
            .split(SP)
            .map(|classname| {
                // skip already scoped classes
                let is_scoped = ScopedSelector::is_scoped(classname);
                if is_scoped {
                    return classname.to_string();
                }

                ScopedSelector::new(classname, scope).name
            })
            .collect::<Vec<String>>();

        // add the new generated class name to the class list
        let scoped_class = ScopedSelector::new(&tag_name, scope).name;
        class_list.push(scoped_class);

        // turn list into a string
        let class_list = class_list.join(SP);

        // edit the class attr with the new scoped values
        attrs
            .entry("class".to_string())
            .and_modify(|v| *v.value_mut() = Some(class_list));

        // attrs back to string
        let attrs = attrs_to_string(attrs);

        // ship it with the rest of the line without old attrs
        let rest = line.get(end_tok_i..).unwrap_or("");
        return format!("{start_token}{SP}{}{rest}", attrs.trim());
    }

    // no class attribute but valid tag name
    if let Some(tag_name) = tag_name {
        let scoped_class = ScopedSelector::new(&tag_name, scope).name;
        // add the new scoped class to the list of attrs
        let mut scoped_class_props = Prop::new("class");
        *scoped_class_props.value_mut() = Some(scoped_class);
        attrs.insert("class".to_string(), scoped_class_props);

        // transform attrs back to string
        let attrs = attrs_to_string(attrs);

        // ship it
        let rest = line.get(end_tok_i..).unwrap_or("");
        return format!("{start_token}{SP}{}{rest}", attrs.trim());
    }

    return line.to_string();
}

fn scope_component_html(code: &str, scope: &str) -> String {
    let mut result = String::new();
    let mut lines = code.lines();
    let mut line = lines.next();

    if code.is_empty() || is_text_node(code) {
        return code.to_string();
    }

    while line.is_some() {
        let pre = line.unwrap();
        let trimmed = pre.trim();
        let is_comment = trimmed.starts_with(HTML_COMMENT_START_TOKEN);

        if pre.is_empty() || is_comment {
            result.push_str(pre);
            line = lines.next();
            continue;
        }

        if let Some(tag_name) = get_tag_name(pre) {
            // don't transform these
            let skip = vec!["style", "script", "slot"];
            if !skip.contains(&tag_name.as_ref()) {
                let transformed = transform_attrs_with_scope(pre, tag_name, scope);

                result.push_str(&transformed);
                result.push_str(NL);
                line = lines.next();
                continue;
            }
        }

        result.push_str(pre);
        result.push_str(NL);
        line = lines.next();
    }

    result
}

fn evaluate_props(
    list: Option<&String>,
    props_sep_tok: &str,
    props_value_tok: &str,
    handler: fn(name: &str, value: Option<&str>) -> Prop,
) -> PropMap {
    let mut map = PropMap::new();

    if let Some(props) = list {
        let prop_list = props.split(props_sep_tok);

        for prop_item in prop_list {
            if prop_item.contains(props_value_tok) {
                let mut prop = prop_item.split(props_value_tok);
                let name = prop.next().unwrap();
                let value = prop.next();
                let prop = handler(name, value);
                map.insert(name.to_string(), prop);
            } else {
                let prop = Prop::new(prop_item.trim());
                map.insert(prop_item.trim().to_string(), prop);
            }
        }
    }

    return map;
}

fn get_props_dict(list: Option<&String>) -> PropMap {
    evaluate_props(list, ",", ":", |name, value| {
        let mut c_prop = Prop::new(name.trim());

        if let Some(value) = value {
            *c_prop.default_mut() = Some(value.trim().to_string());
        }

        c_prop
    })
}

fn get_tag_attrs(list: Option<&String>) -> PropMap {
    // space is not enough to split html attrs because valus may contain space
    // so split with this token "\"{SP}" where SP is space
    let html_split_tok = format!("\"{SP}");

    evaluate_props(list, &html_split_tok, "=", |name, value| {
        let mut c_prop = Prop::new(name.trim());

        if let Some(value) = value {
            // the value here has quotes because is read from html attributes
            // remove the double quotes
            let value = value.replace("\"", "");
            *c_prop.value_mut() = Some(value.trim().to_string());
        }

        c_prop
    })
}

fn attrs_to_string(attrs: PropMap) -> String {
    let acc = &mut String::new();
    attrs
        .values()
        .fold(acc, |acc: &mut String, attr| {
            acc.push_str(&attr.to_string());
            acc
        })
        .to_string()
}

fn resolve_props(code: &str, props_dict: PropMap, passed_props: PropMap) -> String {
    let result = String::from(code);

    fn resolve(code: String, templates: Vec<String>, value: String) -> String {
        let mut result = String::new();

        let double_quotes = &templates[0];
        let single_quotes = &templates[1];
        let css_prop = &templates[2];

        for line in code.lines() {
            // contains the prop in a css custom property
            if line.contains(css_prop) {
                // add a definition of the custom prop just before its used
                let custom_prop = format!("{css_prop}: {value};");
                result.push_str(&custom_prop);
                result.push_str(NL);
                result.push_str(line);
                result.push_str(NL);
                continue;
            }

            if line.contains(double_quotes) {
                let replaced = line.replace(double_quotes, &value);
                result.push_str(&replaced);
                result.push_str(NL);
                continue;
            }

            if line.contains(single_quotes) {
                let replaced = line.replace(single_quotes, &value);
                result.push_str(&replaced);
                result.push_str(NL);
                continue;
            }

            result.push_str(line);
            result.push_str(NL);
        }

        result
    }

    // match usage props with the defined props lists and process each of them
    for (prop_name, mut prop_meta) in passed_props {
        // verify if the passed prop is used on the component
        if props_dict.contains_key(&prop_name) {
            let used_prop = props_dict.get(&prop_name);

            if let Some(used) = used_prop {
                // passed the default value to the passed prop if it exists
                if let Some(value) = &used.default {
                    *prop_meta.default_mut() = Some(value.trim().to_string());
                }
            }

            if let Some(value) = prop_meta.value {
                return resolve(result, prop_meta.templates, value);
            }

            if let Some(value) = prop_meta.default {
                return resolve(result, prop_meta.templates, value);
            }
        }
    }

    result
}

fn transform_component(
    file: &PathBuf,
    c_id: &str,
    c_code: &String,
    is_nested: bool,
    usage_count: i32,
    passed_props: PropMap,
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

    let attrs = get_attrs_inline(code);
    // read component props
    let props_dict = if let Some(c_props) = attrs.get("data-props") {
        get_props_dict(c_props.value.as_ref())
    } else {
        PropMap::default()
    };

    let is_fragment = if let Some(frag_attr) = attrs.get("data-fragment") {
        frag_attr.value.as_ref().unwrap_or(&"false".to_string()) == "true"
    } else {
        false
    };

    // fragments are not scoped
    let c_scope = if is_fragment {
        "".to_string()
    } else {
        let mut with_instance = String::from(code);
        // modify the checksum for each instance
        with_instance.push_str(&usage_count.to_string());
        checksum(&with_instance).as_hex
    };

    // code with processed props
    let code = resolve_props(code, props_dict, passed_props);
    // now get the inner html
    let c_inner_html = consume_component_inner_html(&code);

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

        let parsed = transform_css(style_code, &c_scope);
        parsed_css_and_script.push_str(&parsed);
        tags = replace_chunk(&tags, style_code, "");
    }

    if has_script {
        let script_start_i = script_start.unwrap();
        let script_end_i = script_end.unwrap();

        let script_code = c_inner_html
            .get(script_start_i..script_end_i + script_end_token.len())
            .unwrap_or("");

        let parsed = transform_script(script_code, &c_scope, usage_count);
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

        // let first_line = rest.lines().next().unwrap_or("");
        let has_root_node = has_root_node(&rest);

        let c_attrs = format!(
            "{}=\"{c_scope}\"{SP}{}=\"{is_nested}\"{SP}{}=\"{c_id}\"{SP}{}=\"{usage_count}\"",
            DATA_SCOPE_TOKEN, DATA_NESTED_TOKEN, DATA_COMPONENT_NAME, DATA_COMPONENT_INSTANCE
        );

        if !has_root_node {
            let scoped_code = format!("<div{SP}{c_attrs}>{rest}</div>{parsed_css_and_script}");
            return Ok(scoped_code);
        }

        if has_root_node {
            // scope every element
            let scoped_code = scope_component_html(&rest, &c_scope);
            let scoped_code = format!("{scoped_code}{parsed_css_and_script}");
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

    let mut processed = HashMap::<String, Proc>::new();
    // same as processed except items are removed from this map once used properly
    let mut unlisted = HashMap::<String, Unlisted>::new();
    // a list of all linked items to this file
    let mut linked_list = Vec::<Linked>::new();

    // is a component html file
    let is_component = code.starts_with(TEMPLATE_START_TOKEN);

    fn undefined(msg: &str, data: &Unlisted) {
        println!(
            "\n{}{SP}{}:{}:{}\n{msg} {:?} removed\n|\n|>{SP}{}\n|",
            Emoji::FLAG,
            no_cwd_path_as_str(&data.meta.file),
            data.cursor.line,
            data.cursor.col,
            data.meta.name,
            Colors::bold(&data.html)
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

        let is_linked_rel = pre.contains("rel=") && pre.contains("href=");
        let is_linked_src = pre.contains("src=");
        let is_linked_component = pre.contains("rel=\"component\"");

        if is_linked_rel {
            let attrs = get_attrs_inline(pre);
            let href_path = attrs.get("href").unwrap();

            if let Some(path) = &href_path.value {
                let asset = evaluate_url(file, path).unwrap_or_default();
                // add to the list of linked items
                linked_list.push(Linked {
                    file: file.to_owned(),
                    asset,
                    is_component: is_linked_component,
                })
            }
        }

        if is_linked_src {
            let attrs = get_attrs_inline(pre);
            let src_path = attrs.get("src").unwrap();

            if let Some(path) = &src_path.value {
                let asset = evaluate_url(file, path).unwrap_or_default();
                // add to the list of linked items
                linked_list.push(Linked {
                    file: file.to_owned(),
                    asset,
                    is_component: is_linked_component,
                })
            }
        }

        let trimmed = pre.trim();

        let is_inline_link = trimmed.starts_with(LINK_START_TOKEN)
            && trimmed.contains("href")
            && trimmed.contains(">");
        let is_component_link = trimmed.contains("rel=\"component\"") && is_inline_link;
        // "line_number > 1" checks surely that this is not the first line of a file
        // skipping a root template tag
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
                line_number.add_assign(1);
                line = lines.next();
                commented_line = line.unwrap();
                write(commented_line);
            }

            line = lines.next();
            continue;
        }

        // *** parse in-file component
        if is_inner_template {
            let attrs = get_attrs_inline(trimmed);

            if let Some(id_attr) = attrs.get("id") {
                let c_id = id_attr.value.as_ref().and_then(|v| get_valid_id(v));

                if c_id.is_none() {
                    // Silently ignore templates with no valid component ID
                    // templates may obvs be used for other things
                    line = lines.next();
                    continue;
                }

                let c_id = c_id.unwrap();
                let c_html = consume_tag_html(trimmed, &mut lines, "template");

                // update line number with the corrent number of lines skiped
                let len_skipped: i32 = c_html.lines().count().try_into().unwrap_or_default();
                line_number.add_assign(len_skipped);

                let mut parsed = transform(&c_html, file)?;
                // append to the current linked list
                linked_list.append(&mut parsed.linked_list);

                let c_html = parsed.code;

                let data = Proc {
                    meta: Meta {
                        name: c_id.to_owned(),
                        file: file.to_owned(),
                    },
                    html: c_html.to_owned(),
                    usage: 0,
                };

                processed.insert(c_id.to_owned(), data);
                unlisted.insert(
                    c_id.to_owned(),
                    Unlisted {
                        meta: Meta {
                            name: c_id.to_owned(),
                            file: file.to_owned(),
                        },
                        cursor: Cursor {
                            line: line_number,
                            col: 0,
                        },
                        html: c_html.to_owned(),
                    },
                );

                // skip only when a valid component id is found
                line = lines.next();
                continue;
            }
        }

        // *** parse inline link tag
        if is_component_link {
            let attrs = get_attrs_inline(trimmed);

            if let Some(id_attr) = attrs.get("id") {
                let c_id = id_attr.value.as_ref().and_then(|v| get_valid_id(v));

                if c_id.is_none() {
                    println!(
                        "Linked component {} does not have a valid id. ignored",
                        Emoji::LINK
                    );

                    line = lines.next();
                    continue;
                }

                let c_id = c_id.unwrap();
                let href_attr = attrs.get("href").unwrap();
                let c_url = href_attr
                    .value
                    .as_ref()
                    .and_then(|url| evaluate_url(&file, &url));

                if let Some(c_file) = c_url {
                    // check if the linked file exists
                    if c_file.metadata().is_err() {
                        let data = Unlisted {
                            meta: Meta {
                                name: c_id.to_owned(),
                                file: c_file,
                            },
                            cursor: Cursor {
                                line: line_number,
                                col: 0,
                            },
                            html: trimmed.to_string(),
                        };

                        undefined("Component not found", &data);
                        line = lines.next();
                        continue;
                    }

                    let code = read_file(&c_file)?;
                    let mut parsed = transform(&code, &c_file)?;
                    // append to the current linked list
                    linked_list.append(&mut parsed.linked_list);

                    let c_html = parsed.code;

                    let data = Proc {
                        meta: Meta {
                            name: c_id.to_owned(),
                            file: c_file.to_owned(),
                        },
                        html: c_html.to_owned(),
                        usage: 0,
                    };

                    processed.insert(c_id.to_owned(), data);
                    unlisted.insert(
                        c_id.to_owned(),
                        Unlisted {
                            meta: Meta {
                                name: c_id.to_owned(),
                                file: c_file.to_owned(),
                            },
                            cursor: Cursor {
                                line: line_number,
                                col: 0,
                            },
                            html: c_html.to_owned(),
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
            let c_name = get_tag_name(trimmed).unwrap();
            let entry = processed.get_mut(c_name.as_str());

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
                    html: trimmed.to_string(),
                };

                undefined("Undefined component", &data);
                continue;
            }

            let data = entry.unwrap();
            data.inc_usage(1);

            // Update the line count
            let tag_inner_html = consume_until_end_token(&mut lines.clone(), &c_name);

            let len: i32 = tag_inner_html
                .1
                .lines()
                .count()
                .try_into()
                .unwrap_or_default();

            // add to the line number, the number of inner items plus the end tag
            // obvs inline component usage is already accounted for
            if !trimmed.contains(UNPAIRED_TAG_CLOSE_TOKEN) {
                line_number.add_assign(len + 1);
            }

            let passed_props = get_attrs_inline(trimmed);

            let parsed_code = transform_component(
                &data.meta.file,
                &data.meta.name,
                &data.html,
                is_component,
                data.usage,
                passed_props,
            )?;

            let resolved = resolve_component(trimmed, &mut lines, &c_name, &parsed_code);

            // remove from unlisted
            unlisted.remove_entry(c_name.as_str());

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
