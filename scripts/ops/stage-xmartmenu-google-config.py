#!/usr/bin/env python3
"""Stage eight Google variables through Coolify loopback; offline by default."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

APP = "gmaayluj11x1m6j7baogonfn"
IMAGE = "sha256:06645e194800d6ed0ef8e2e729991affd14c6bec057a1e98e71359062d4a58b6"
INPUT = Path("/opt/xmartmenu/google-identity-ops/google-auth.env")
FIXED = {
    "GOOGLE_AUTH_ENABLED": "false",
    "GOOGLE_AUTH_PROJECT_ID": "skaleclub",
    "GOOGLE_AUTH_PROJECT_NUMBER": "937861185231",
    "GOOGLE_AUTH_ADC_FILE": "/run/secrets/xmartmenu-google-identity/adc.json",
    "GOOGLE_AUTH_ADC_AUDIENCE": "//iam.googleapis.com/projects/937861185231/locations/global/workloadIdentityPools/hetzner-xmartmenu/providers/x509",
    "GOOGLE_AUTH_ADC_SERVICE_ACCOUNT": "xmartmenu-firebase-auth-reader@skaleclub.iam.gserviceaccount.com",
    "GOOGLE_AUTH_ADC_SUBJECT": "spiffe://skale.club/apps/xmartmenu/production",
}
KEYS = set(FIXED) | {"GOOGLE_AUTH_WEB_API_KEY"}
ENV = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LANG": "C"}

# Only the supported token model writes directly. Environment mutations use the
# installed controller's POST API; read-only model checks see only these 8 values.
PHP = r'''
error_reporting(0);
ini_set('display_errors', '0');
$phase = 'bootstrap'; $issued = null; $ok = false; $revoked = true; $created = false;
function demand($value) { if (!$value) { throw new RuntimeException('STAGING_GUARD_FAILED'); } }
try {
    require '/var/www/html/vendor/autoload.php';
    $laravel = require '/var/www/html/bootstrap/app.php';
    $laravel->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $laravel['config']->set('app.debug', false);
    $input = json_decode(stream_get_contents(STDIN, 16385), true, 32, JSON_THROW_ON_ERROR);
    $values = $input['values'] ?? [];
    $fixed = [
        'GOOGLE_AUTH_ENABLED'=>'false', 'GOOGLE_AUTH_PROJECT_ID'=>'skaleclub',
        'GOOGLE_AUTH_PROJECT_NUMBER'=>'937861185231',
        'GOOGLE_AUTH_ADC_FILE'=>'/run/secrets/xmartmenu-google-identity/adc.json',
        'GOOGLE_AUTH_ADC_AUDIENCE'=>'//iam.googleapis.com/projects/937861185231/locations/global/workloadIdentityPools/hetzner-xmartmenu/providers/x509',
        'GOOGLE_AUTH_ADC_SERVICE_ACCOUNT'=>'xmartmenu-firebase-auth-reader@skaleclub.iam.gserviceaccount.com',
        'GOOGLE_AUTH_ADC_SUBJECT'=>'spiffe://skale.club/apps/xmartmenu/production',
    ];
    $keys = array_merge(array_keys($fixed), ['GOOGLE_AUTH_WEB_API_KEY']);
    demand(is_array($values) && count($values) === 8 && !array_diff(array_keys($values), $keys));
    foreach ($fixed as $key=>$value) { demand(($values[$key] ?? null) === $value); }
    demand(is_string($values['GOOGLE_AUTH_WEB_API_KEY']) && preg_match('/^AIza[A-Za-z0-9_-]{35}$/D', $values['GOOGLE_AUTH_WEB_API_KEY']) === 1);
    $phase = 'model-preflight';
    $loadApplication = static fn() => App\Models\Application::with('environment.project', 'settings')
        ->where('uuid', 'gmaayluj11x1m6j7baogonfn')->firstOrFail();
    $pinApplication = static function ($application) {
        demand($application->id === 2 && $application->environment_id === 1 && $application->build_pack === 'dockercompose'
            && $application->environment->project->id === 1 && $application->environment->project->team_id === 0
            && $application->git_repository === 'Skale-Club/xmartmenu' && $application->git_branch === 'main'
            && $application->docker_compose_location === '/docker-compose.yaml');
    };
    $application = $loadApplication(); $pinApplication($application);
    $settingsBefore = $application->settings->getRawOriginal();
    $previewMetadata = static fn() => App\Models\ApplicationPreview::where('application_id', 2)->orderBy('id')
        ->get(['id','status'])->map(static fn($row) => $row->getRawOriginal())->all();
    $previewsBefore = $previewMetadata();
    $user = App\Models\User::findOrFail(0);
    $team = $user->teams()->where('teams.id', 0)->firstOrFail();
    demand($team->pivot->role === 'owner');
    $rows = static function () use ($keys) {
        return App\Models\EnvironmentVariable::where('resourceable_type', App\Models\Application::class)
            ->where('resourceable_id', 2)->whereIn('key', $keys)->get();
    };
    $matches = static function ($row, $value, $preview) {
        // Laravel may normalize an empty preview request value to SQL NULL.
        $same = $row->value === $value || ($preview && $value === '' && $row->value === null);
        return $same && $row->is_preview === $preview && (bool)$row->is_literal === true
            && (bool)$row->is_multiline === false && (bool)$row->is_runtime === true
            && (bool)$row->is_buildtime === false && (bool)$row->is_shown_once === true;
    };
    $previewValues = array_fill_keys($keys, ''); $previewValues['GOOGLE_AUTH_ENABLED'] = 'false';
    $existing = $rows(); $missing = [];
    // Production-created observers copy values to preview when its row is
    // absent. Preseed safe preview rows first, through the supported API.
    foreach ([true, false] as $preview) {
        foreach (($preview ? $previewValues : $values) as $key=>$value) {
            $selected = $existing->where('key', $key)->where('is_preview', $preview);
            demand($selected->count() <= 1);
            if ($selected->count()) { demand($matches($selected->first(), $value, $preview)); }
            else { $missing[] = ['key'=>$key, 'value'=>$value, 'preview'=>$preview]; }
        }
    }
    // Capture only metadata for unrelated environment rows, never their values.
    $otherMetadata = static function () use ($keys) {
        return App\Models\EnvironmentVariable::where('resourceable_type', App\Models\Application::class)
            ->where('resourceable_id', 2)->whereNotIn('key', $keys)->orderBy('id')
            ->get(['id','key','is_preview','is_runtime','is_buildtime','is_literal','is_multiline','is_shown_once'])
            ->map(static fn($row) => $row->getRawOriginal())->all();
    };
    $unrelated = $otherMetadata();
    $phase = 'token-create';
    // No existing plaintext administrative credential is accepted or searched.
    // The exact ephemeral model is revoked below, even after an API exception.
    $issued = $user->createToken('xmartmenu-google-config-stage', ['read','write','deploy'], now()->addMinutes(10), 0);
    $revoked = false;
    demand($issued->accessToken->team_id === 0 && $issued->accessToken->tokenable_id === 0
        && $issued->accessToken->abilities === ['read','write','deploy']);
    $deadline = microtime(true) + 80;
    $api = static function ($method, $path, $body = null) use ($issued, $deadline) {
        demand(in_array($method, ['GET','POST','PATCH'], true));
        demand(in_array($path, ['/applications/gmaayluj11x1m6j7baogonfn', '/applications/gmaayluj11x1m6j7baogonfn/envs'], true));
        demand($method !== 'POST' || $path === '/applications/gmaayluj11x1m6j7baogonfn/envs');
        demand($method !== 'PATCH' || ($path === '/applications/gmaayluj11x1m6j7baogonfn'
            && $body === ['is_preview_deployments_enabled'=>false]));
        $remaining = $deadline - microtime(true); demand($remaining > 0);
        $client = Illuminate\Support\Facades\Http::withToken($issued->plainTextToken)->acceptJson()
            ->connectTimeout(2)->timeout(min(8, $remaining))->withoutRedirecting();
        $url = 'http://127.0.0.1:8080/api/v1'.$path;
        $response = match ($method) { 'GET'=>$client->get($url), 'POST'=>$client->post($url, $body),
            'PATCH'=>$client->patch($url, $body) };
        demand($response->status() === ($method === 'POST' ? 201 : 200));
        demand(strlen($response->body()) <= 1048576);
        return $response->json();
    };
    $phase = 'api-preflight';
    $publicApplication = $api('GET', '/applications/gmaayluj11x1m6j7baogonfn');
    demand(is_array($publicApplication) && ($publicApplication['uuid'] ?? null) === 'gmaayluj11x1m6j7baogonfn');
    $phase = 'api-disable-automatic-previews';
    if ($application->settings->is_preview_deployments_enabled !== false) {
        $api('PATCH', '/applications/gmaayluj11x1m6j7baogonfn', ['is_preview_deployments_enabled'=>false]);
    }
    $application = $loadApplication(); $pinApplication($application);
    demand($application->settings->is_preview_deployments_enabled === false);
    $settingsAfter = $application->settings->getRawOriginal();
    foreach (['updated_at','is_preview_deployments_enabled'] as $field) {
        unset($settingsBefore[$field], $settingsAfter[$field]);
    }
    demand($settingsBefore === $settingsAfter);
    $phase = 'api-preflight';
    $inventory = $api('GET', '/applications/gmaayluj11x1m6j7baogonfn/envs');
    demand(is_array($inventory));
    foreach ($keys as $key) {
        $apiRows = array_values(array_filter($inventory, static fn($row) => is_array($row) && ($row['key'] ?? null) === $key));
        demand(count($apiRows) === $existing->where('key', $key)->count());
    }
    $phase = 'api-create';
    foreach ($missing as $item) {
        $key = $item['key']; $preview = $item['preview'];
        $phase = $preview ? 'api-preseed-preview' : 'api-create';
        // Recheck immediately before POST; never PATCH, bulk upsert or overwrite.
        $current = $rows();
        demand($current->where('key', $key)->where('is_preview', $preview)->isEmpty());
        if (!$preview) {
            foreach ($previewValues as $previewKey=>$previewValue) {
                $safe = $current->where('key', $previewKey)->where('is_preview', true);
                demand($safe->count() === 1 && $matches($safe->first(), $previewValue, true));
            }
        }
        $api('POST', '/applications/gmaayluj11x1m6j7baogonfn/envs', [
            'key'=>$key, 'value'=>$item['value'], 'is_preview'=>$preview, 'is_literal'=>true,
            'is_multiline'=>false, 'is_runtime'=>true, 'is_buildtime'=>false, 'is_shown_once'=>true,
        ]);
        $created = true;
    }
    $phase = 'model-postverify';
    $final = $rows(); demand($final->count() === 16);
    foreach ([true, false] as $preview) {
        foreach (($preview ? $previewValues : $values) as $key=>$value) {
            $selected = $final->where('key', $key)->where('is_preview', $preview);
            demand($selected->count() === 1 && $matches($selected->first(), $value, $preview));
        }
    }
    demand($otherMetadata() === $unrelated);
    demand($previewMetadata() === $previewsBefore);
    $application = $loadApplication(); $pinApplication($application);
    demand($application->settings->is_preview_deployments_enabled === false);
    $ok = true;
} catch (Throwable $error) {
    $ok = false; // No exception text, request/response body or values leave PHP.
} finally {
    if ($issued !== null) {
        try {
            $id = $issued->accessToken->getKey();
            $issued->accessToken->delete();
            $revoked = !$issued->accessToken->newQuery()->whereKey($id)->exists();
        } catch (Throwable $error) { $revoked = false; }
    }
    if (!$revoked) { $ok = false; $phase = 'token-revoke'; }
}
$output = ['configStaged'=>$ok,'tokenRevoked'=>$revoked,'createdAny'=>$created,
    'googleAuthRemainsDisabled'=>$ok,'existingGoogleValuesPreserved'=>$ok,
    'unrelatedEnvironmentMetadataPreserved'=>$ok,'previewIsolated'=>$ok,'automaticPreviewsDisabled'=>$ok,
    'existingPreviewsPreserved'=>$ok,'deploymentRequested'=>false];
if (!$ok) { $output['failurePhase'] = $phase; }
echo json_encode($output).PHP_EOL;
exit($ok ? 0 : 1);
'''


def require(value):
    if not value:
        raise ValueError("Google configuration staging stopped")


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError("Invalid staging arguments")


def parse_values(data):
    require(isinstance(data, bytes) and 0 < len(data) <= 16384)
    values = {}
    for line in data.decode("ascii").splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(separator and key in KEYS and key not in values)
        if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
            value = value[1:-1]
        values[key] = value
    require(set(values) == KEYS and all(values[key] == value for key, value in FIXED.items()))
    require(re.fullmatch(r"AIza[A-Za-z0-9_-]{35}", values["GOOGLE_AUTH_WEB_API_KEY"]) is not None)
    return values


def read_input():
    for path in (Path("/"), Path("/opt"), Path("/opt/xmartmenu"), INPUT.parent):
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid == 0
                and not info.st_mode & 0o022)
    info = INPUT.parent.lstat()
    require(info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700)
    fd = os.open(INPUT, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and info.st_gid == 0
                and stat.S_IMODE(info.st_mode) == 0o600 and 0 < info.st_size <= 16384)
        data = os.read(fd, 16385)
        require(len(data) == info.st_size)
        return parse_values(data)
    finally:
        os.close(fd)


def command(args, data=None, timeout=20, allow_failure=False):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=timeout, env=ENV, check=False)
    require(len(result.stdout) <= 1048576 and (allow_failure or result.returncode == 0))
    return result


def snapshot(command_fn=command):
    names = command_fn(["/usr/bin/docker", "ps", "--format", "{{.Names}}"]).stdout.decode("ascii").splitlines()
    names = [name for name in names if name.startswith("app-" + APP + "-")]
    require(len(names) == 1)
    template = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"started":{{json .State.StartedAt}},"health":{{json .State.Health.Status}},"mounts":{{json .Mounts}}}'
    state = json.loads(command_fn(["/usr/bin/docker", "inspect", "--format", template, names[0]]).stdout)
    require(state["image"] == IMAGE and state["running"] is True and state["health"] == "healthy")
    identity = json.loads(command_fn(["/usr/bin/docker", "exec", names[0], "node", "-e",
                                    "console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid()}))"]).stdout)
    require(identity == {"uid": 1000, "gid": 1000})
    return state


def apply(values, command_fn=command, snapshot_fn=snapshot):
    before = snapshot_fn()
    result = command_fn(["/usr/bin/docker", "exec", "-i", "coolify", "php", "-r", PHP],
                        json.dumps({"values": values}).encode("ascii"), 110, True)
    proof = json.loads(result.stdout)
    expected = {"configStaged", "tokenRevoked", "createdAny", "googleAuthRemainsDisabled",
                "existingGoogleValuesPreserved", "unrelatedEnvironmentMetadataPreserved", "previewIsolated",
                "automaticPreviewsDisabled", "existingPreviewsPreserved", "deploymentRequested"}
    require(isinstance(proof, dict) and set(proof) <= expected | {"failurePhase"}
            and expected <= set(proof) and all(type(proof[key]) is bool for key in expected))
    require(snapshot_fn() == before)
    acceptance = ("configStaged", "tokenRevoked", "googleAuthRemainsDisabled", "previewIsolated",
                  "automaticPreviewsDisabled", "existingPreviewsPreserved", "existingGoogleValuesPreserved",
                  "unrelatedEnvironmentMetadataPreserved")
    if not (result.returncode == 0 and all(proof[key] for key in acceptance) and not proof["deploymentRequested"]):
        phases = {"bootstrap", "model-preflight", "token-create", "api-preflight", "api-disable-automatic-previews", "api-preseed-preview", "api-create",
                  "model-postverify", "token-revoke"}
        phase = proof.get("failurePhase")
        return {"configStaged": False, "tokenRevoked": proof["tokenRevoked"],
                "productionContainerUnchanged": True, "failurePhase": phase if phase in phases else "unknown"}
    return {**proof, "productionContainerUnchanged": True, "productionHealthy": True,
            "productionMountChanged": False, "applicationEnvironmentActivated": False}


def main(argv=None):
    parser = Parser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    if not args.apply:
        print(json.dumps({"planOnly": True, "inputRead": False, "networkCallsMade": False,
                          "application": APP, "allowedKeys": sorted(KEYS), "googleAuthEnabled": False,
                          "deploymentRequested": False, "temporaryTokenMinutes": 10}, sort_keys=True))
        return 0
    require(sys.platform.startswith("linux") and os.geteuid() == 0)
    values = read_input()
    import fcntl
    fd = os.open(INPUT.parent / ".google-config-stage.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and info.st_gid == 0
                and stat.S_IMODE(info.st_mode) == 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        proof = apply(values)
        print(json.dumps(proof, sort_keys=True))
        return 0 if proof["configStaged"] else 1
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        print('{"configStaged":false,"credentialBearingDiagnosticsEmitted":false}')
        sys.exit(1)
