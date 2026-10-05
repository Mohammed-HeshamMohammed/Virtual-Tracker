// Windows 7/8 cannot run a Chromium engine newer than 109. Next.js executes
// this file before the application hydrates, so these focused polyfills also
// protect startup code from newer APIs introduced by future dependencies.
import "core-js/features/array/to-reversed"
import "core-js/features/array/to-sorted"
import "core-js/features/array/to-spliced"
import "core-js/features/array/with"
import "core-js/features/promise/with-resolvers"
