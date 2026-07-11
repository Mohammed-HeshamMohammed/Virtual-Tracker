from vt_agent.config import settings
from vt_agent.core.controller import AgentController
from vt_agent.ui.app import run_ui


def main() -> None:
    controller = AgentController(settings)
    run_ui(controller)


if __name__ == "__main__":
    main()
