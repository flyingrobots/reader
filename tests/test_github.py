import subprocess

import pytest

from reader_mcp.github import GhCli, GitHubError, MAX_RESPONSE, Uncertain


def gh(stdout):
    return GhCli(executable='/synthetic/gh', runner=lambda argv, **kw: subprocess.CompletedProcess(argv, 0, stdout, ''))


def test_an_oversized_answer_to_a_write_is_uncertain_so_it_is_reconciled():
    with pytest.raises(Uncertain):
        gh(' ' * (MAX_RESPONSE + 1)).call('POST', 'repos/acme/widget/issues', {'title': 'x'}, write=True)


def test_an_oversized_answer_to_a_read_is_a_plain_error():
    with pytest.raises(GitHubError) as error:
        gh(' ' * (MAX_RESPONSE + 1)).call('GET', 'repos/acme/widget')
    assert not isinstance(error.value, Uncertain)


@pytest.mark.parametrize('answer', ['{}', 'null', '[]', '{"number": 0}'])
@pytest.mark.parametrize('method,args', [('create_issue', ('acme/widget', 'title', 'body')),
                                         ('create_pull_request', ('acme/widget', 'main', 'reader/x', 'title', 'body'))])
def test_a_write_answered_without_a_resource_number_is_uncertain(answer, method, args):
    with pytest.raises(Uncertain):
        getattr(gh(answer), method)(*args)
