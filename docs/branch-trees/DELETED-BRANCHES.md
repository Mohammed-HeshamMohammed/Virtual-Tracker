# Branch deletion record — 2026-09-04T05:38:38Z

Branches deleted to leave only `main` plus the six production branches.
Every SHA below is recoverable with:
```bash
git push origin <sha>:refs/heads/<branch-name>
```
Commits stay reachable in the remote until GitHub garbage-collects them.

## Kept
- `Auth-Production` feac8ef183c25eccc512a77a976a924661128a87
- `DashboardBackend-Prod` a186fa6326d4a239e072ada5e9ada1ea4de76054
- `LandingWeb-Prod` c01d66e587145c872d9cb3aea1996c2d784af700
- `LandingWebBackend-Prod` 328c648e8aecf40637ed7f2d7213e5ecb7c21ced
- `dashboard-web-production` 7420385177319349e621e30620725d40c450e222
- `main` 6b471a731607970360ed21e9855d71141b15a57c
- `notify-Production` 5a38a3b0d83949cf96ac0b6e4b329c135e94792c

## Deleted
- `chore/pin-ci-dependencies` 8175353308b97f6121a9f93f61f236c3ceae50e4
- `claude/virtual-tracker-plan-review-5b95v3` c042c63bafd789d903ce6ce3162a234f3babffb8
- `dependabot/cargo/Tauri-App-Extension/src-tauri/base64-0.23.1` 242540b62685d512b387b446222eded70ab7c4d3
- `dependabot/cargo/Tauri-App-Extension/src-tauri/log-0.4.34` 4be1cb4283b51f486837850498205970e7e5ceef
- `dependabot/cargo/Tauri-App-Extension/src-tauri/rand-0.10.2` 890c4369921d129703909c61a5f92056ed5a8a93
- `dependabot/cargo/Tauri-App-Extension/src-tauri/windows-0.61.3` 6a024dcb065df440a3a2cb6314396c40e24870f1
- `dependabot/cargo/Tauri-App-Extension/src-tauri/xcap-0.9.8` 9875f5a48554d0bf0c29c3bb427be1c106ce70a2
- `dependabot/docker/Auth-Backend/node-26-alpine` b319967a9e7716d66a78958a1979cb66022f19f7
- `dependabot/docker/Dashboard-Backend/node-26-alpine` 5b786c66f6af6a8dc0ffd193c3dd2861554d6e7d
- `dependabot/docker/Dashboard-Web/node-26-alpine` 4f594302e914b776fbf3d92762d12c1b512f0be7
- `dependabot/docker/Landing-Backend/node-26-alpine` bb3929bc1d5cb43746660dd4ab1cabf247276d72
- `dependabot/docker/Landing-Web/node-26-alpine` 030eb65090a4e3392a34992ec9bbd3d048bd2409
- `dependabot/github_actions/actions/checkout-7` 71037b45a9d3fa7968afbcdde7b5300f4024dd3a
- `dependabot/github_actions/actions/setup-node-7` c3a83218b9c5bb6799b707054f953451d79b7052
- `dependabot/github_actions/tauri-apps/tauri-action-1` eb879b650d61ae6d3f854c5b5562a8650a831a4f
- `dependabot/npm_and_yarn/Auth-Backend/firebase-admin-14.3.0` 10901be2f3b8e03022a18bd7176f79b2a6aaca13
- `dependabot/npm_and_yarn/Auth-Backend/zod-4.5.4` a8a7c8256a870f911615f6dbbda60ad342d778c2
- `dependabot/npm_and_yarn/Dashboard-Backend/archiver-8.0.0` 977146981e6fdda1eb9ce77c3615aa52c9821563
- `dependabot/npm_and_yarn/Dashboard-Backend/ioredis-6.0.0` e2d0bf67e97b7d8e226547559da72fecfa15c003
- `dependabot/npm_and_yarn/Dashboard-Backend/pg-8.23.0` 5bcb539cca715f76041475bfe234df0f0eb9bdcb
- `dependabot/npm_and_yarn/Dashboard-Backend/ws-8.21.3` 41deedee7b751081bd1fa296c717192c388a7c1c
- `dependabot/npm_and_yarn/Dashboard-Backend/zod-4.4.3` ab3dff8ca786db4f570623cb23b577430386f778
- `dependabot/npm_and_yarn/Dashboard-Web/autoprefixer-10.5.4` a503f07a9f76d5e7c1c3fbe9a66aa7ad9f56b71a
- `dependabot/npm_and_yarn/Dashboard-Web/date-fns-4.4.0` 99104c0f3e6edea9fcff28f8ace08e869079e35f
- `dependabot/npm_and_yarn/Dashboard-Web/fast-uri-3.1.5` ac906bd44e9149b9d0e0a7fc68a64d3a1e61c312
- `dependabot/npm_and_yarn/Dashboard-Web/multi-9b1536b8cd` 3596da2f6f7b590dd056058032c51eb0003837a6
- `dependabot/npm_and_yarn/Dashboard-Web/multi-d8ec5a502f` 89e391f2792f516349dda877ec35a721ec7e9560
- `dependabot/npm_and_yarn/Dashboard-Web/radix-ui/react-switch-1.3.7` e83030cbb127cb346438c39be7c2248a0f138888
- `dependabot/npm_and_yarn/Landing-Backend/zod-4.5.4` 2922de53b3de7616a4c90a06fb1d86823418e52b
- `dependabot/npm_and_yarn/Landing-Web/multi-9b1536b8cd` d6718fc3bfb49d3793a799b79156a712bc7bb6cb
- `dependabot/npm_and_yarn/Landing-Web/multi-d8ec5a502f` ef8c19766130842f4477f226a3283ed848df0fde
- `dependabot/npm_and_yarn/Landing-Web/next-16.3.2` 51558a129c8d946e34a27087e76b971bea0fab71
- `dependabot/npm_and_yarn/Landing-Web/tailwindcss-4.3.3` 392e7217f3f95b0c47f91af1195018138ee2e467
- `dependabot/npm_and_yarn/Landing-Web/tailwindcss/postcss-4.3.3` 73173406b770fe5b9409b5f891d1febaf12508d0
- `dependabot/npm_and_yarn/Notify-backend/firebase-admin-14.3.0` 4105f4429331a482ad707cc9c5f27ea3db61fa40
- `dependabot/npm_and_yarn/Notify-backend/libphonenumber-js-1.13.11` b4426c7cd3f35eb33cd57824983869a5d8a272f9
- `dependabot/npm_and_yarn/Notify-backend/nodemailer-9.0.5` 1669c5e5ff43cb660b26f2b388a80f9d474a2012
- `dependabot/npm_and_yarn/Notify-backend/pg-8.23.0` 4999f5f8ef1c144a21bef8bc43031e2bd5572930
- `dependabot/npm_and_yarn/Notify-backend/zod-4.4.3` 96d76d0f0616c8a0e73ffc78ae58e5872bd9484e
- `dependabot/npm_and_yarn/Tauri-App-Extension/postcss-8.5.25` 730e53dcc6ba39b0643687c54e87a847d5bf9899
- `dependabot/npm_and_yarn/Tauri-App-Extension/types/react-19.2.18` 6d93548b56945062c7ed1ea24a1d0667d4ae4b71
- `dependabot/npm_and_yarn/Tauri-App-Extension/types/react-dom-19.2.4` 63c112c88f7aa505442dd09d4a457cc76a33d935
- `dependabot/npm_and_yarn/Tauri-App-Extension/typescript-7.0.2` 70960efe6d9602a6a303b7ac50a757dae663d0cf
- `dependabot/npm_and_yarn/Tauri-App-Extension/vite-8.2.2` bada35672153ce23d9093683e0b9d7ea7d8b2fb4
- `dependabot/npm_and_yarn/Tauri-App-Extension/vitejs/plugin-react-6.1.0` 79a1b8454a7b7445a97776eaa9f1c02c767b47ba
- `feat/activity-avatar-photos` 8c622706b4354a96a19a4e2afaa0cb88cd68ea8d
- `feat/activity-pages-redesign` 97e3ac3a8871920efe6cc2a5fe57b53f0771ad59
- `feat/add-time-from-manual-requests-page` e757b5102a78a7c1a591ff1d152cd643d2f3bc8a
- `feat/all-reports-avatar-photos` d4993c0993542573faf468664037cba8870da1b0
- `feat/browser-url-categories` 34f68d365bbb37199f6729e806b685d8bcc3e0d6
- `feat/chart-fill-width-and-activity-ux` b4da2635c7d0860cbb499a469d0f2cd1e718739c
- `feat/manual-entry-dropdown-and-budget-anchor` 99f0b2d400f01fcb88f97638200704f1ec38df57
- `feat/manual-entry-project-scope-and-chart-scrollbar` 074ffc59a6710bd616866217bc23320e96e6de08
- `feat/manual-time-approvals-and-chart-fix` a0c7ecab442c71e6f71bbbecd4eb2b85a94ecff0
- `feat/manual-time-member-picker` f65db6765242490d99ba9c428f1b3a2cd263aa32
- `feat/manual-time-task-rule` 249529b5c61d554d2d82915c415519880139f160
- `feat/pay-rate-history-supermanager-gate` 8edae7bd0f5e7cb68d5b96cc6ec5a46530f7f337
- `feat/report-grouping-and-role-aware-agent` 5714a66df3bba320195ffee30d2f9544ed8d0d44
- `feat/report-tables-width-aware-columns` e8b0caee3fa56cb4d6c2f8f9959c600e3954353f
- `feat/session-delete-and-button-fixes` f020d8be2c5e99d8d53b3b700292a2c6e23e7541
- `feat/task-duration-overtime-hm` 51214b12efce3e1b1c996d18a61d6f03f35bcde4
- `feat/task-modal-tabs` e14aed1deb0324c769929cd4f6a44299cb04842d
- `feat/task-project-budget-cap` 0cacf3444ad1ff634a4f05fc313058dd46cef8ae
- `feat/time-activity-delete-cascade` 5eedba30d075b83d4dc782e35a40106680a25eec
- `feat/timesheets-pay-rate-project-linking` 89c7bdc3d3426aa2e9ecc8a69c0cd78528c4cb92
- `fix/activity-card-cleanup` 3b73af29143825f28fcd20eff81b7c86536bc89f
- `fix/activity-summary-above-and-global` 9e9566845feb0ccef32a857418fa1b9ebfab40d1
- `fix/activity-summary-above-bar-and-mobile-wrap` 584947f78d715f54f3c5b1ab54e7b044b6cfa729
- `fix/activity-week-percent` 93754b24356e1db51392dfdc6479c7d37f0c2757
- `fix/add-time-entry-dropdown-styling` 3ed47b704c9a1f444b2a3005610d6595862cbd15
- `fix/auth-action-continue-url` 0c4ca3a75c75ef3c9b8dec2a4eda69cf6fd05f0e
- `fix/chart-flat-zero-and-project-budget-money-hours` f1236f4f926dc91f1ce4b0bdad6609956952119b
- `fix/chart-scrollbar-rounding` 4c37d4c0aaafbf2fb2a9afce3a7dc0b1b0b74e77
- `fix/classify-all-time-list` 3a9bbe1e11b9a557ce42bcf8feee2493ff9e11f3
- `fix/main-pane-task-and-assigned-today` c19e74e5bcb62cb367ed1cf33416be63a6850ce0
- `fix/member-edit-modal-theme-consistency` 3fdb5aa82f436dcbba67d3a2f61475a9b2110985
- `fix/remove-stale-installers` 4a830e08d86dd56b1833a333809646b4329a2fc1
- `fix/report-chart-width-and-payment-modal` 3d86bba69eef1ed740e072a36ec32bbb34d6f2b1
- `fix/report-schedule-silent-failure` 627548539702d485f7f28c600c900ef1692177d4
- `fix/reports-currency-per-member` 9a0ec9b8e6133f9e51643ea48d06c4d52b675737
- `fix/reports-empty-rows-dropdown-clip` 1041f011cac4e2c176735fad2b5732c4cba3019f
- `fix/reports-scrollbars-delete-button` 09076b85e34037639f7079846bfae4053fe6b0af
- `fix/timer-view-toggle-active-state` fb39b44ba324711c41d9f8ceea161ec4bf57ee2a
- `fix/weekly-activity-and-historical-rates` 2ee86415042b92cac59748a4dd28b1bf4ec2c97a
