import os
import urllib.request
import urllib.parse
import webbrowser
from vt_agent.log import log

def open_url_in_launcher_or_browser(fallback_url: str, link_token: str | None = None) -> None:
    """
    Attempts to open a URL/link in the local launcher's Dashboard.
    If the launcher is not active, falls back to opening the system's default browser.
    """
    launcher_port = os.environ.get("VT_LAUNCHER_PORT")
    opened_in_launcher = False
    
    if launcher_port:
        try:
            url = f"http://localhost:{launcher_port}/open"
            if link_token:
                encoded_token = urllib.parse.quote(link_token)
                url += f"?link={encoded_token}"
            log.info(f"Requesting local launcher to open URL: {url}")
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=3) as response:
                if response.status == 200:
                    log.info("Successfully opened link via local launcher")
                    opened_in_launcher = True
        except Exception as e:
            log.warning("Failed to open link via local launcher API: %s", e)
            
    if not opened_in_launcher:
        log.info("Falling back to default system browser for URL: %s", fallback_url)
        webbrowser.open(fallback_url)
