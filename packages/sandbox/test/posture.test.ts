/**
 * The container posture, asserted from the argv rather than from a comment.
 *
 * These need no container runtime, which is the point: the security boundary
 * should be checkable on a machine that cannot run a container at all, and by
 * a reviewer reading the test rather than trusting the prose.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertPostureIntact, assertSafeImage, DockerError, runArgv } from '../src/index.ts';

const argv = runArgv('rigorrun-verify-abc123', { image: 'rigorrun-target:t0000000000a' });

describe('the container posture', () => {
  it('gives the target no network', () => {
    expect(argv).toContain('--network');
    expect(argv[argv.indexOf('--network') + 1]).toBe('none');
  });

  it('makes the image layer read-only and drops every capability', () => {
    expect(argv).toContain('--read-only');
    expect(argv).toContain('--cap-drop');
    expect(argv[argv.indexOf('--cap-drop') + 1]).toBe('ALL');
    expect(argv).toContain('--security-opt');
    expect(argv[argv.indexOf('--security-opt') + 1]).toBe('no-new-privileges');
  });

  it('does not run as root inside the container either', () => {
    expect(argv).toContain('--user');
    const user = argv[argv.indexOf('--user') + 1] ?? '';
    expect(user).not.toMatch(/^0:/);
    expect(user).toBe('65532:65532');
  });

  it('caps processes, memory and CPU, so exhaustion hits a wall', () => {
    expect(argv).toContain('--pids-limit');
    expect(argv).toContain('--memory');
    expect(argv).toContain('--cpus');
    // Swap equal to memory, or the memory limit can be walked around.
    const memory = argv[argv.indexOf('--memory') + 1];
    expect(argv[argv.indexOf('--memory-swap') + 1]).toBe(memory);
  });

  it('mounts nothing from this machine, and no container runtime socket', () => {
    for (const forbidden of ['-v', '--volume', '--mount', '--privileged', '--cap-add']) {
      expect(argv).not.toContain(forbidden);
    }
    expect(argv.join(' ')).not.toContain('docker.sock');
    expect(argv.join(' ')).not.toContain('/var/run');
  });

  it('gives the container no environment at all', () => {
    expect(argv).not.toContain('-e');
    expect(argv).not.toContain('--env');
    expect(argv).not.toContain('--env-file');
  });

  it('names the container, so it can be removed without knowing a pid', () => {
    expect(argv).toContain('--name');
    expect(argv).toContain('--label');
    expect(argv).toContain('rigorrun.harness=1');
  });

  /**
   * `--rm` is not enough on its own. The process we spawn is the docker
   * client, and killing it does not necessarily stop the container — which is
   * why the name and the label exist.
   */
  it('still asks for automatic removal', () => {
    expect(argv).toContain('--rm');
  });

  it('refuses an argument that would undo any of this', () => {
    for (const attack of ['--privileged', '-v', '--mount', '--cap-add=SYS_ADMIN', '--net=host']) {
      expect(() => assertPostureIntact(['run', attack, 'image:tag'])).toThrow(DockerError);
    }
    expect(() => assertPostureIntact(['run', '-v', '/var/run/docker.sock:/x'])).toThrow(DockerError);
  });

  it('refuses an image reference it did not build', () => {
    expect(() => assertSafeImage('evil; rm -rf /')).toThrow(DockerError);
    expect(() => assertSafeImage('--privileged')).toThrow(DockerError);
    expect(assertSafeImage('node:20-alpine')).toBe('node:20-alpine');
    expect(assertSafeImage(`node@sha256:${'a'.repeat(64)}`)).toBeTruthy();
  });

  it('refuses a container name that is not one RigorRun generated', () => {
    expect(() => runArgv('name with spaces', { image: 'x:1' })).toThrow(DockerError);
    expect(() => runArgv('--privileged', { image: 'x:1' })).toThrow(DockerError);
  });
});

describe('the generated image', () => {
  /**
   * The property that makes a build safe: there is no point during image
   * construction at which the target's own code can execute.
   */
  it('has no RUN instruction, so nothing the target ships runs at build time', async () => {
    const stage = await readFile(fileURLToPath(new URL('../src/stage.ts', import.meta.url)), 'utf8');
    const dockerfileLines = /const DOCKERFILE|'FROM \$\{BASE_IMAGE_TAG\}'|`FROM \$\{BASE_IMAGE_TAG\}`/;
    expect(stage).toMatch(dockerfileLines);
    // No emitted Dockerfile line may begin with RUN.
    expect(stage).not.toMatch(/['"`]RUN /);
  });

  it('installs with lifecycle scripts disabled', async () => {
    const stage = await readFile(fileURLToPath(new URL('../src/stage.ts', import.meta.url)), 'utf8');
    // Every npm install in this file must carry it.
    const installs = stage.match(/'install'[\s\S]{0,400}?\]/g) ?? [];
    expect(installs.length).toBeGreaterThan(0);
    for (const install of installs) expect(install).toContain('--ignore-scripts');
  });
});
