#[cfg(test)]

mod statica {
    use crate::core_t::Result as R;
    use crate::statica::statica;
    use crate::util::file;
    use std::path::PathBuf;

    pub struct TestResult {
        pub result: String,
        pub expected: String,
    }

    fn format_expected(source: String) -> String {
        source
            .lines()
            .map(|line| {
                // trim everything but empty lines, to try and match the generated output
                let mut result = String::new();
                result.push_str(line.trim());
                result.push_str("\n");
                return result;
            })
            .collect::<Vec<String>>()
            .join("")
    }

    pub fn parse_h(input: &str, expected: &str) -> R<TestResult> {
        let file = PathBuf::from(input);
        let expected = PathBuf::from(expected);
        let expected = file::read_code(&expected)?;
        let code = file::read_code(&file)?;

        let parsed = statica::transform(&code, &file)?;
        let expected = format_expected(expected);

        Ok(TestResult {
            result: parsed.code,
            expected,
        })
    }

    #[test]
    fn parse_hello_world() -> R<()> {
        const HELLO_INPUT: &str = "src/test/files/hello/input.html";
        const HELLO_EXPECTED: &str = "src/test/files/hello/expected.html";
        let res = parse_h(HELLO_INPUT, HELLO_EXPECTED)?;

        assert_eq!(res.result, res.expected);
        Ok(())
    }

    #[test]
    fn parse_fragment() -> R<()> {
        const FRAGMENT_INPUT: &str = "src/test/files/fragment/input.html";
        const FRAGMENT_EXPECTED: &str = "src/test/files/fragment/expected.html";
        let res = parse_h(FRAGMENT_INPUT, FRAGMENT_EXPECTED)?;

        assert_eq!(res.result, res.expected);
        Ok(())
    }
}
