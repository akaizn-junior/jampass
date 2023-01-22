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
    util::{
        constants::{
            BODY_TAG_OPEN, COMPONENT_PREFIX_TOKEN, COMPONENT_TAG_START_TOKEN, CSS_AT_TOKEN,
            CSS_OPEN_RULE_TOKEN, DATA_COMPONENT_INSTANCE, DATA_COMPONENT_NAME, DATA_NESTED_TOKEN,
            DATA_SCOPE_TOKEN, GLOBAL_CORE_SCRIPT_ID, GLOBAL_CSS_ID, GLOBAL_SCRIPT_ID,
            HTML_COMMENT_END_TOKEN, HTML_COMMENT_START_TOKEN, JS_CLIENT_CORE_PATH,
            LINK_START_TOKEN, NL, QUERY_FACTORY_TOKEN, QUERY_FN_NAME, SP, STATIC_QUERY_FN_TOKEN,
            TEMPLATE_END_TOKEN, TEMPLATE_START_TOKEN, UNPAIRED_TAG_CLOSE_TOKEN,
        },
        data, path,
        statica_t::{
            Checksum, Cursor, Directive, Linked, Meta, Proc, Prop, PropMap, PropMeta, Props,
            ScopedSelector, TransformOutput, Unlisted,
        },
    },
};

// *** HELPERS ***

/// Should be a valid uncomment line containing a given token
fn is_uncommented(line: &str, token: &str, check: fn(&str, &str) -> bool) -> bool {
    let trimmed = line.trim_start();
    // the default values here dont matter, they are set so that we can unwrap the values in place
    // if either token is not found, it should default to the comment index being larger, way larger
    // because if token_index is found but no comment_index, you want it to be always larger, so the check matches
    let token_index = trimmed.find(token).unwrap_or(0);
    let comment_index = trimmed.find(HTML_COMMENT_START_TOKEN).unwrap_or(999999999);
    let is_uncommented = token_index < comment_index;
    check(trimmed, token) && is_uncommented
}

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

/// Evaluates component directives and passes directive props to the list of props
fn evaluate_usage_directives(proc: &Proc, usage_props: PropMap) -> Directive {
    let props_dict = proc.props.to_owned().unwrap_or_default();

    if let Ok(data) = data::get_data() {
        // handle passed props with this mutable var
        let map = &mut PropMap::from(usage_props.to_owned());

        if let Some(prop) = usage_props.get(":for-each") {
            // remove directive from the original proplist
            map.remove(&prop.name);

            let directive_body = &prop.value;
            if let Some(body) = directive_body {
                // create an actual prop with the data from the directive body
                let mut new_prop = Prop::new(body);
                // define it with an empty value for now
                *new_prop.value_mut() = Some("".to_string());
                // update prop meta
                *new_prop.prop_meta_mut() = PropMeta {
                    source: "directive".to_string(),
                };
                // add new prop to the map
                map.insert(body.to_string(), new_prop);

                // check if the prop is in the component's props definition
                if props_dict.contains_key(body) {
                    return Directive {
                        render_count: data.length,
                        props: map.to_owned(),
                    };
                } else {
                    let usage_html = proc.usage_html.to_owned().unwrap_or_default();
                    println!(
                        "\n{}{SP}{}:{}:{}\nunused prop {:?}/ component used here\n|\n|>{SP}{}\n|\n",
                        Emoji::FLAG,
                        no_cwd_path_as_str(&proc.meta.file),
                        proc.meta.cursor.line,
                        proc.meta.cursor.col,
                        body,
                        Colors::bold(usage_html.as_str())
                    );
                }

                return Directive {
                    render_count: 1,
                    props: map.to_owned(),
                };
            }
        }
    }

    Directive {
        render_count: 1,
        props: usage_props,
    }
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
            .and_modify(|prop| *prop.value_mut() = Some(class_list));

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

/// Adds a scope to every element in the component line by line
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

fn resolve_props(code: &str, data: &Proc, render_index: usize) -> Result<String> {
    let result = String::from(code);

    fn resolve(
        code: String,
        templates: Vec<String>,
        value: &str,
        render_index: usize,
    ) -> Result<String> {
        let mut result = String::new();
        let data = data::get_data().ok().unwrap();

        let dquotes_template = &templates[0];
        let squotes_template = &templates[1];
        let css_template = &templates[2];
        let value_template = &templates[3];

        for line in code.lines() {
            // is a data $value
            let is_data_value =
                is_uncommented(line, value_template, |line, tok| line.contains(tok));

            if is_data_value {
                let value_i = line.find(value_template).unwrap();
                let end_i = line.get(value_i..).unwrap().find("\")");

                if let Some(end_i) = end_i {
                    let start = value_i + value_template.len();
                    let end = end_i + value_i;
                    let key = line.get(start..end).unwrap();

                    let value_tok = format!("{value_template}{key}\")");
                    let data_item = &data.for_each[render_index];

                    if let Some(val) = data_item.pointer(key) {
                        if let Some(data) = val.as_str() {
                            let replaced = line.replace(&value_tok, data);
                            result.push_str(&replaced);
                            result.push_str(NL);
                        }
                    }
                }

                continue;
            }

            // contains the prop in a css custom property
            if is_uncommented(line, css_template, |line, tok| line.contains(tok)) {
                // add a definition of the custom prop just before its used
                let custom_prop = format!("{css_template}: {value};");
                result.push_str(&custom_prop);
                result.push_str(NL);
                result.push_str(line);
                result.push_str(NL);
                continue;
            }

            if is_uncommented(line, dquotes_template, |line, tok| line.contains(tok)) {
                let replaced = line.replace(dquotes_template, &value);
                result.push_str(&replaced);
                result.push_str(NL);
                continue;
            }

            if is_uncommented(line, squotes_template, |line, tok| line.contains(tok)) {
                let replaced = line.replace(squotes_template, &value);
                result.push_str(&replaced);
                result.push_str(NL);
                continue;
            }

            result.push_str(line);
            result.push_str(NL);
        }

        Ok(result)
    }

    let usage_props = data.usage_props.to_owned();
    if usage_props.is_none() {
        return Ok(code.to_string());
    }

    let props_dict = data.props.to_owned().unwrap_or_default();
    let mut usage_props = usage_props.unwrap();

    // match usage props with the defined props lists and process each of them
    for (prop_name, prop) in props_dict {
        // verify if the dictionary contains passed props
        if let Some(used) = usage_props.get_mut(&prop_name) {
            // passed the default value to the passed prop if it exists
            if let Some(value) = &prop.default {
                *used.default_mut() = Some(value.trim().to_string());
            }

            if used.meta.source.eq("directive") {
                let value = used.value.to_owned().unwrap_or_default();
                return resolve(result, prop.templates, &value, render_index);
            }

            if let Some(value) = &used.value {
                return resolve(result, prop.templates, value, render_index);
            }

            if let Some(value) = &used.default {
                return resolve(result, prop.templates, &value, render_index);
            }
        } else {
            let usage_html = data.usage_html.to_owned().unwrap_or_default();

            println!(
                "\n{}{SP}{}:{}:{}\nundefined prop {:?}/ component used here\n|\n|>{SP}{}\n|\n",
                Emoji::FLAG,
                no_cwd_path_as_str(&data.meta.file),
                data.meta.cursor.line,
                data.meta.cursor.col,
                prop.name,
                Colors::bold(usage_html.as_str())
            );
        }

        // no code, if a var is not properly used, to avoid static code to pass through
        return Ok("".to_string());
    }

    Ok(result)
}

/// Replaces component slots with their placements AKA component children
fn fill_component_slots(c_code: &String, c_children: &str) -> String {
    let mut result = String::new();
    result.push_str(c_code);

    let mut lines = c_children.lines();

    // a dict for all named placements
    let mut named = HashMap::<String, String>::new();
    // the rest
    let mut rest = Vec::<&str>::new();

    // *** Collect placements

    let mut line = lines.next();
    while line.is_some() {
        let elem = line.unwrap();

        if is_uncommented(elem, "slot=", |line, tok| line.contains(tok)) {
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

        // join all captured lines for the catch all slot
        let catch_all_html = rest.join(NL);

        let is_catch_all = is_uncommented(elem, "<slot", |line, tok| {
            line.contains(tok) && !line.contains("name=\"")
        });

        if is_catch_all {
            let slot_tag_html = consume_tag_html(elem, &mut lines, "slot");
            result = replace_chunk(&result, &slot_tag_html, &catch_all_html);
            line = lines.next();
            continue;
        }

        let is_named = is_uncommented(elem, "<slot", |line, tok| {
            line.contains(tok) && line.contains("name=\"")
        });

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

fn resolve_component(data: &Proc, render_index: usize, is_nested: bool) -> Result<String> {
    let file = &data.meta.file;
    let c_id = &data.meta.name;
    let usage_count = data.usage;
    let is_fragment = data.is_fragment.unwrap_or(false);

    // fill slots if component has children
    let c_code = if let Some(inner_html) = &data.usage_inner_html {
        fill_component_slots(&data.html, &inner_html)
    } else {
        data.html.to_owned()
    };

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
    let code = resolve_props(code, &data, render_index)?;

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
        // there will be two approaches to handle components with and without root elements
        let has_root_node = has_root_node(&rest);

        // when there is no root node, wrap component elements with a div with scoped attributes
        if !has_root_node {
            let scoped_attrs = format!(
                "{}=\"{c_scope}\"{SP}{}=\"{is_nested}\"{SP}{}=\"{c_id}\"{SP}{}=\"{usage_count}\"",
                DATA_SCOPE_TOKEN, DATA_NESTED_TOKEN, DATA_COMPONENT_NAME, DATA_COMPONENT_INSTANCE
            );

            // component code has to be scoped to avoid collisions with other components
            let scoped_code = scope_component_html(&rest, &c_scope);
            let html = format!("<div{SP}{scoped_attrs}>{scoped_code}</div>{parsed_css_and_script}");
            return Ok(html);
        }

        if has_root_node {
            let root_node_line = rest.lines().next().unwrap_or_default();
            let tag_name = get_tag_name(root_node_line).unwrap();
            let tag_start = format!("<{tag_name}");
            let tag_end = format!("</{tag_name}");

            let attrs = get_attrs_inline(root_node_line);
            let mut props = Props::new(attrs);

            props.add_prop(DATA_SCOPE_TOKEN, Some(c_scope.to_string()));
            props.add_prop(DATA_NESTED_TOKEN, Some(is_nested.to_string()));
            props.add_prop(DATA_COMPONENT_NAME, Some(c_id.to_string()));
            props.add_prop(DATA_COMPONENT_INSTANCE, Some(usage_count.to_string()));

            let root_attrs = props.to_string();
            let inner_html = consume_component_inner_html(&rest);
            let with_root_attrs =
                format!("{tag_start}{SP}{root_attrs}{SP}>{NL}{inner_html}{tag_end}>");

            // component code has to be scoped to avoid collisions with other components
            let html = scope_component_html(&with_root_attrs, &c_scope);
            return Ok(html);
        }
    }

    Ok("".to_string())
}

/// Replaces the static component with the code generated
fn transform_component(lines: &mut Lines, data: &mut Proc, is_nested: bool) -> Result<String> {
    // get usage html
    let usage_html = &data.usage_html.to_owned().unwrap();
    // collect all transformed lines
    let mut result = String::new();
    // get component attributes
    let attrs = get_attrs_inline(&data.html);

    let is_fragment = if let Some(frag_attr) = attrs.get("data-fragment") {
        frag_attr.value.as_ref().unwrap_or(&"false".to_string()) == "true"
    } else {
        false
    };

    // update processed data with is_fragment
    *data.is_fragment_mut() = Some(is_fragment);

    // read component props
    let props_dict = if let Some(c_props) = attrs.get("data-props") {
        get_props_dict(c_props.value.as_ref())
    } else {
        PropMap::default()
    };

    // add component props to processed data
    *data.props_mut() = Some(props_dict);

    // get usage props
    let usage_props = get_attrs_inline(usage_html);
    // check usage props for directives, eval them and then update processed data with the new evald props
    let directive = evaluate_usage_directives(data, usage_props);
    // add evald props to processed data
    *data.usage_props_mut() = Some(directive.props);

    // how many time should render based on a directive
    let render_count = directive.render_count;

    let c_id = &data.meta.name;
    let ctag_open_token = format!("<{}", c_id);
    let ctag_close_token = format!("</{}", c_id);

    // does this line contain a tag openning
    let tag_open = usage_html.contains(&ctag_open_token);
    // should indicate the closing of an open tag
    let tag_close = usage_html.contains(&ctag_close_token);
    // for when a component is declared as an unpaired tag
    let unpaired_close = usage_html.contains(&UNPAIRED_TAG_CLOSE_TOKEN);

    // something line <tag />
    let is_unpaired_inline = tag_open && unpaired_close;
    if is_unpaired_inline {
        for render_index in 0..render_count {
            let c_code = resolve_component(data, render_index, is_nested)?;
            result.push_str(&c_code);
        }

        return Ok(result);
    }

    // something line <tag \n\n /> or <tag> \n\n </tag>
    let is_unpaired_tag = tag_open
        && !usage_html.contains(UNPAIRED_TAG_CLOSE_TOKEN)
        && !usage_html.contains(&ctag_close_token);

    if is_unpaired_tag {
        let end_match = consume_until_end_token(lines, c_id);

        // for when it terminates the paired tag with a /> token
        const UNPAIRED_CODE: i32 = 0;
        if end_match.0.eq(&UNPAIRED_CODE) {
            for render_index in 0..render_count {
                let c_code = resolve_component(data, render_index, is_nested)?;
                result.push_str(&c_code);
            }
        }

        // fot when it finds a matching paired tag, such as </tag>
        const PAIRED_CODE: i32 = 1;
        if end_match.0.eq(&PAIRED_CODE) {
            *data.usage_inner_html_mut() = Some(end_match.1);

            for render_index in 0..render_count {
                let c_code = resolve_component(data, render_index, is_nested)?;
                result.push_str(&c_code);
            }
        }

        // ok, done!
        return Ok(result);
    }

    // something like <tag></tag> in the same line
    let is_paired_inline = tag_open && tag_close;
    if is_paired_inline {
        *data.usage_inner_html_mut() = consume_inner_html_inline(usage_html);

        for render_index in 0..render_count {
            let c_html = resolve_component(data, render_index, is_nested)?;
            result.push_str(&c_html);
        }

        // ok, done!
        return Ok(result);
    }

    result.push_str(usage_html);
    return Ok(result);
}

// *** INTERFACE ***

pub fn transform(code: &String, file: &PathBuf) -> Result<TransformOutput> {
    let code = code.trim_start();
    let mut lines = code.lines();
    let mut line = lines.next();
    let mut line_number: usize = 0;
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
            data.meta.cursor.line,
            data.meta.cursor.col,
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

        let is_linked_rel = is_uncommented(pre, "<link", |line, _| {
            line.contains("rel=") && line.contains("href=")
        });

        let is_linked_src = is_uncommented(pre, "<link", |line, _| line.contains("src="));
        let is_linked_component =
            is_uncommented(pre, "<link", |line, _| line.contains("rel=\"component\""));

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

        let is_inline_link = is_uncommented(pre, "<link", |line, _| {
            line.starts_with(LINK_START_TOKEN) && line.contains("href") && line.contains(">")
        });

        let is_component_link = is_inline_link
            && is_uncommented(pre, "<link", |line, _| line.contains("rel=\"component\""));

        // "line_number > 1" checks surely that this is not the first line of a file
        // skipping a root template tag
        let is_inner_template = line_number > 1
            && is_uncommented(pre, TEMPLATE_START_TOKEN, |line, _| line.contains(">"));

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
                let len_skipped = c_html.lines().count();
                line_number.add_assign(len_skipped);

                let mut parsed = transform(&c_html, file)?;
                // append to the current linked list
                linked_list.append(&mut parsed.linked_list);

                let c_html = parsed.code;

                let data = Proc {
                    meta: Meta {
                        name: c_id.to_owned(),
                        file: file.to_owned(),
                        cursor: Cursor {
                            line: line_number,
                            col: 0,
                        },
                    },
                    is_fragment: None,
                    props: None,
                    html: c_html.to_owned(),
                    usage_inner_html: None,
                    usage: 0,
                    usage_props: None,
                    usage_html: None,
                };

                processed.insert(c_id.to_owned(), data);
                unlisted.insert(
                    c_id.to_owned(),
                    Unlisted {
                        meta: Meta {
                            name: c_id.to_owned(),
                            file: file.to_owned(),
                            cursor: Cursor {
                                line: line_number,
                                col: 0,
                            },
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
                                cursor: Cursor {
                                    line: line_number,
                                    col: 0,
                                },
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
                            cursor: Cursor {
                                line: line_number,
                                col: 0,
                            },
                        },
                        is_fragment: None,
                        props: None,
                        html: c_html.to_owned(),
                        usage_inner_html: None,
                        usage: 0,
                        usage_props: None,
                        usage_html: None,
                    };

                    processed.insert(c_id.to_owned(), data);
                    unlisted.insert(
                        c_id.to_owned(),
                        Unlisted {
                            meta: Meta {
                                name: c_id.to_owned(),
                                file: c_file.to_owned(),
                                cursor: Cursor {
                                    line: line_number,
                                    col: 0,
                                },
                            },
                            html: c_html.to_owned(),
                        },
                    );
                }
            }

            line = lines.next();
            continue;
        }

        // obvs only process components not comments
        let is_component_tag = is_uncommented(pre, COMPONENT_TAG_START_TOKEN, |line, _| {
            line.starts_with(COMPONENT_TAG_START_TOKEN)
        });

        if is_component_tag {
            let c_name = get_tag_name(trimmed).unwrap();
            let entry = processed.get_mut(c_name.as_str());

            if entry.is_none() {
                line = lines.next();

                let data = Unlisted {
                    meta: Meta {
                        name: c_name,
                        file: file.to_owned(),
                        cursor: Cursor {
                            line: line_number,
                            col: 0,
                        },
                    },
                    html: trimmed.to_string(),
                };

                undefined("Undefined component", &data);
                continue;
            }

            let data = entry.unwrap();
            data.inc_usage(1);
            *data.usage_html_mut() = Some(trimmed.to_string());

            // Update the line count
            let tag_inner_html = consume_until_end_token(&mut lines.clone(), &c_name);
            let len = tag_inner_html.1.lines().count();
            // add to the line number, the number of inner items plus the end tag
            // obvs inline component usage is already accounted for
            if !trimmed.contains(UNPAIRED_TAG_CLOSE_TOKEN) {
                line_number.add_assign(len + 1);
            }

            let transformed = transform_component(&mut lines, data, is_component)?;
            // remove from unlisted
            unlisted.remove_entry(c_name.as_str());

            write(&transformed);
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
