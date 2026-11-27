# Copyright 2026 Yves Goldberg (Ygol InternetWork)
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
from odoo.tests import HttpCase, tagged

from odoo.addons.web.tests.test_js import qunit_error_checker


@tagged("post_install", "-at_install")
class TestHtmlMermaidQUnit(HttpCase):
    """Run the QUnit suite of the module in a headless browser."""

    def setUp(self):
        super().setUp()
        self.admin = self.env.ref("base.user_admin")
        # Reason: browser_js logs in with password = login; on a copy of a
        # production database the admin password differs (rolled back after).
        self.admin.password = self.admin.login
        # Reason: a neutralized database shows a banner in the page body, which
        # the QUnit cleanup check reports as a leftover of the first test.
        banner = self.env.ref("web.neutralize_banner", raise_if_not_found=False)
        if banner:
            banner.active = False

    def test_qunit_suite(self):
        """The QUnit suite of the module passes."""
        self.browser_js(
            "/web/tests?filter=web_html_mermaid",
            "",
            "",
            login=self.admin.login,
            timeout=600,
            error_checker=qunit_error_checker,
        )
