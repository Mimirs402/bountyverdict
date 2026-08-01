#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_dir="$script_dir/systemd"
config_root=${XDG_CONFIG_HOME:-"$HOME/.config"}
target_dir=${BOUNTYVERDICT_SYSTEMD_USER_DIR:-"$config_root/systemd/user"}
systemctl_bin=${BOUNTYVERDICT_SYSTEMCTL:-systemctl}
service_name=bountyverdict-distribution-monitor.service
timer_name=bountyverdict-distribution-monitor.timer
dropin_dir="$target_dir/$service_name.d"

mkdir -p -- "$target_dir"
if [ -L "$target_dir" ] || [ ! -d "$target_dir" ] || [ "$(stat -c %u "$target_dir")" != "$(id -u)" ]; then
  echo "Refusing an untrusted systemd user-unit directory: $target_dir" >&2
  exit 1
fi

install -m 0644 -- "$source_dir/$service_name" "$target_dir/$service_name"
install -m 0644 -- "$source_dir/$timer_name" "$target_dir/$timer_name"

for retired in \
  30-experiment-decision-gate.conf \
  40-agent-question-v7-activation.conf \
  50-current-monitor.conf \
  60-free-selector-activation.conf \
  70-audited-monitor.conf \
  90-preserve-free-selector-epoch.conf
do
  rm -f -- "$dropin_dir/$retired"
done

"$systemctl_bin" --user daemon-reload
effective=$("$systemctl_bin" --user show "$service_name" \
  --property=FragmentPath \
  --property=DropInPaths \
  --property=ExecStart \
  --property=ExecStartPre \
  --property=Environment \
  --property=NeedDaemonReload \
  --no-pager)

case "$effective" in
  *"FragmentPath=$target_dir/$service_name"*) ;;
  *) echo "Effective distribution monitor fragment is not the installed unit." >&2; exit 1 ;;
esac
case "$effective" in
  *"scripts/distribution-monitor.ts"*) ;;
  *) echo "Effective distribution monitor does not run distribution-monitor.ts." >&2; exit 1 ;;
esac
case "$effective" in
  *"REPORT_ONLY=YES"*) ;;
  *) echo "Effective distribution monitor is not report-only." >&2; exit 1 ;;
esac
case "$effective" in
  *"run-audited-monitor.ts"*|*"AUDITED_MONITOR=distribution"*)
    echo "Effective distribution monitor still contains semantic-retrieval wiring." >&2
    exit 1
    ;;
esac
for retired in \
  30-experiment-decision-gate.conf \
  40-agent-question-v7-activation.conf \
  50-current-monitor.conf \
  60-free-selector-activation.conf \
  70-audited-monitor.conf \
  90-preserve-free-selector-epoch.conf
do
  case "$effective" in
    *"/$retired"*) echo "Retired distribution override remains loaded: $retired" >&2; exit 1 ;;
  esac
done
case "$effective" in
  *"NeedDaemonReload=no"*) ;;
  *) echo "systemd still requires a daemon reload." >&2; exit 1 ;;
esac

printf '%s\n' "Installed and verified the report-only BountyVerdict distribution monitor."
