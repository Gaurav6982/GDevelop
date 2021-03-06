const shell = require('shelljs');
const child = require('child_process');
const axios = require('axios');

const extractCommitsFromGit = () => {
  const lastTag = child
    .execSync(`git describe --tags --abbrev=0`)
    .toString('utf-8')
    .trim();
  shell.echo(`ℹ️ Last tag is ${lastTag}`);

  const output = child
    .execSync(
      `git log ${lastTag}..HEAD --format=%B---DELIMITER---%ae---DELIMITER---%H---COMMITDELIMITER---`
    )
    .toString('utf-8');

  return (
    output
      .split('---COMMITDELIMITER---\n')
      .map(commit => {
        const [message, authorEmail, sha] = commit.split('---DELIMITER---');

        return { sha, message, authorEmail };
      })
      // Clean commits
      .filter(commit => Boolean(commit.sha))
      .map(commit => ({
        message: commit.message.trim(),
        authorEmail: commit.authorEmail.trim(),
      }))
      // Categorize commits
      .map(commit => {
        const lowerCaseMessage = commit.message.toLowerCase();
        const shouldHide =
          lowerCaseMessage.includes('bump newide version') ||
          lowerCaseMessage.includes('run code formatting') ||
          lowerCaseMessage.includes('fix formatting') ||
          lowerCaseMessage.includes('fix warning') ||
          lowerCaseMessage.includes('package-lock.json');
        const isFix = lowerCaseMessage.indexOf('fix') === 0;

        return {
          message: commit.message.trim(),
          authorEmail: commit.authorEmail.trim(),
          authorNickname: '',
          isFix,
          hidden:
            commit.authorEmail === 'Florian.Rival@gmail.com' && shouldHide,
        };
      })
  );
};

const findAuthorNicknameInCommits = async commits => {
  let authorEmailsToNicknames = {};
  let lastGithubCall = 0;
  function delayGithubCall() {
    return new Promise(resolve => {
      setTimeout(() => {
        lastGithubCall = Date.now();
        resolve();
      }, Math.max(0, lastGithubCall + 500 - Date.now()));
    });
  }

  const findAuthorNicknameFromAuthorEmail = async authorEmail => {
    const cachedNickname = authorEmailsToNicknames[authorEmail];
    if (cachedNickname !== undefined) return cachedNickname;

    if (authorEmail.includes('@users.noreply.github.com')) {
      return authorEmail
        .replace(/@users\.noreply\.github\.com/, '')
        .replace(/^[0-9]*\+/, '');
    }

    try {
      await delayGithubCall();
      console.log(
        `Calling https://api.github.com/search/users?q=${authorEmail}+in:email`
      );
      const response = await axios.get(
        `https://api.github.com/search/users?q=${authorEmail}+in:email`
      );
      const data = response.data;
      const login =
        data && data.items && data.items[0] ? data.items[0].login : '';
      authorEmailsToNicknames[authorEmail] = login;
      if (login) {
        shell.echo(`ℹ️ Found nickname for email: ${authorEmail}:` + login);
      } else {
        shell.echo(`ℹ️ No nickname found for email: ${authorEmail}:` + login);
      }

      return login;
    } catch (error) {
      shell.echo(
        `⚠️ Unable to fetch a user info (email: ${authorEmail})` + error
      );
      return '';
    }
  };

  const outputCommits = [];
  for (let index in commits) {
    const commit = commits[index];
    const authorNickname = await findAuthorNicknameFromAuthorEmail(
      commit.authorEmail
    );

    outputCommits.push({
      ...commit,
      authorNickname,
    });
  }
  return outputCommits;
};

const formatCommitMessage = commit => {
  const includeAuthor = commit.authorNickname !== '4ian';
  const author = includeAuthor
    ? `(Thanks ${
        commit.authorNickname
          ? '@' + commit.authorNickname
          : 'TODO:' + commit.authorEmail
      }!)`
    : '';
  const prNumberCleanedMessage = commit.message.replace(
    /(\(#[1-9][0-9]*\))/,
    ''
  );

  const indentedMessage = prNumberCleanedMessage
    .split('\n')
    .map((line, index) =>
      index === 0
        ? '* ' + line.trimRight() + ' ' + author
        : '  ' + line.trimRight()
    )
    .filter(line => line.trim() !== '')
    .join('\n');

  return indentedMessage;
};

(async () => {
  const commits = extractCommitsFromGit();
  const commitsWithAuthors = await findAuthorNicknameInCommits(commits);

  const hiddenCommits = commitsWithAuthors.filter(commit => commit.hidden);
  const displayedCommits = commitsWithAuthors.filter(commit => !commit.hidden);
  const fixCommits = displayedCommits.filter(commit => commit.isFix);
  const improvementsCommits = displayedCommits.filter(commit => !commit.isFix);

  shell.echo(
    `ℹ️ Hidden these commits: \n${hiddenCommits
      .map(commit => '* ' + commit.message)
      .join('\n')}`
  );

  shell.echo(`\n## 💝 Improvements\n`);
  shell.echo(improvementsCommits.map(formatCommitMessage).join('\n'));

  shell.echo(`\n## 🐛 Bug fixes\n`);
  shell.echo(fixCommits.map(formatCommitMessage).join('\n'));
})();
