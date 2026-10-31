import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobInputPath, userUploadObjectPath } from '../src/upload-path.ts';

const user = '11111111-1111-4111-8111-111111111111';
const job = '22222222-2222-4222-8222-222222222222';
const expected = `user-uploads/${user}/${job}/input.mp4`;

test('derive the current upload layout from the authenticated user and job', () => {
  assert.equal(jobInputPath(user, job, 'Video.MP4'), expected);
  assert.equal(jobInputPath(user, job, 'video.'), expected);
  for (const id of [null, {}, 123, '', '../other', `${job}/../other`]) {
    assert.equal(jobInputPath(user, id, 'video.mp4'), null);
  }
  assert.notEqual(jobInputPath('other-user', job, 'video.mp4'), expected);
});

test('allow only the owner upload bucket and a canonical nonempty object path', () => {
  assert.equal(userUploadObjectPath(expected, user), `${user}/${job}/input.mp4`);
  // Older jobs may use a different filename within their owner folder.
  assert.equal(userUploadObjectPath(`user-uploads/${user}/old.mov`, user), `${user}/old.mov`);
  for (const input of [
    null, {}, 123, '', `user-uploads/other-user/${job}/input.mp4`,
    `user-uploads/${user}-other/${job}/input.mp4`,
    `job-outputs/${user}/${job}/input.mp4`, `user-uploads/${user}`,
    `user-uploads/${user}/`, `user-uploads/${user}//input.mp4`,
    `user-uploads/${user}/../other/input.mp4`,
    `user-uploads/${user}/./input.mp4`,
    `user-uploads/${user}/%2e%2e/other/input.mp4`,
    `user-uploads/${user}/%252e%252e/other/input.mp4`,
    `user-uploads/${user}/..\\other\\input.mp4`,
    `user-uploads/${user}/input.mp4\0`,
  ]) {
    assert.throws(() => userUploadObjectPath(input, user), /Invalid job input path/);
  }
});
