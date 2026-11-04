import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

/**
 * IB-115 (design V27) — production refuses to boot without BUILD_SHA (env.schema.ts). That makes every
 * image build that forgets the arg a failed deploy, so the three places that build the image are pinned
 * here: the Dockerfile turns the arg into the env, and both builders pass the commit's first 12.
 */
const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('BUILD_SHA reaches the image (IB-115, V27)', () => {
  it('the Dockerfile runtime stage sets ENV BUILD_SHA from the build arg', () => {
    const runtime = read('apps/insight-bot/Dockerfile').split(/^FROM .* AS runtime$/m)[1] ?? '';
    expect(runtime).toMatch(/^ARG BUILD_SHA=?$/m);
    expect(runtime).toMatch(/^ENV BUILD_SHA=\$\{BUILD_SHA\}$/m);
  });

  it('push-image.sh builds with --build-arg BUILD_SHA=<commit 12> and checks a LOCAL_IMAGE carries it', () => {
    const script = read('infra/insight-bot/scripts/push-image.sh');
    expect(script).toContain('--build-arg "BUILD_SHA=${COMMIT:0:12}"');
    expect(script).toMatch(/if \[ "\$build_sha" != "\$\{COMMIT:0:12\}" \]; then/);
  });

  it('the CI workflow passes build-args BUILD_SHA from the commit it tags', () => {
    const wf = load(read('.github/workflows/insight-bot-deploy.yml')) as { jobs: Record<string, { steps: Array<{ id?: string; name?: string; run?: string; with?: Record<string, string> }> }> };
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
    const rev = steps.find((s) => s.id === 'rev');
    expect(rev?.run).toContain('echo "build=${sha:0:12}" >>"$GITHUB_OUTPUT"');
    const build = steps.find((s) => s.with?.file === 'apps/insight-bot/Dockerfile');
    expect(build?.with?.['build-args']).toBe('BUILD_SHA=${{ steps.rev.outputs.build }}');
  });
});
