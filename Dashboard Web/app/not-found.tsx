import { HttpErrorPage } from "@/shared/ui/errors"

export default function NotFound() {
  return <HttpErrorPage status={404} />
}
