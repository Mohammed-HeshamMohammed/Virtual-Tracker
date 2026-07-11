from typing import Literal, TypedDict


class ScreenshotEvent(TypedDict):
    type: Literal["screenshot"]
    imageData: str
    appName: str
    pageTitle: str
    activityLevel: int


class AppEvent(TypedDict):
    type: Literal["app"]
    appName: str
    pageTitle: str
    durationSeconds: int


class UrlEvent(TypedDict):
    type: Literal["url"]
    url: str
    pageTitle: str
    durationSeconds: int


ActivityEvent = ScreenshotEvent | AppEvent | UrlEvent
