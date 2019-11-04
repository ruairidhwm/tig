import * as fs from "fs";
import * as nodepath from "path";

let tig = (module.exports = {
  /**
   *
   * @param {*} opts
   * @description
   * Initialises the current directory as a new repo.
   */
  init = opts => {
    // Already a repo? Then abort
    if (files.inRepo()) {
      return;
    }
    opts = opts || {};

    /**
     * Create a JS object that mirrors the git directory
     * structure. If we pass `-bare` then we write to the git config
     * saying that the repo is bare.
     */
    let tigStructure = {
      HEAD: "ref: refs/headers/master\n",

      config: config.objectToStr({
        core: { "": { bare: opts.bare === true } }
      }),

      objects: {},
      refs: {
        heads: {}
      }
    };

    /**
     * Write the standard git directory structure
     * using the `tigStructure` object. If the repo
     * isn't bare then we put the directories inside the
     * `.tig` directory. If the repo is bare then we put
     * them in the top level of the repo.
     */
    files.writeFilesFromTree(
      opts.bare ? tigStructure : { ".tig": tigStructure },
      process.cwd()
    );
  },

  /**
   *
   * @param {*} path
   * @param {*} _
   * @description
   * Add files that match `path` to the index.
   */
  add = (path, _) => {
    files.assertInRepo();
    config.assertNotBare();

    // Get the paths of all files matching path
    let addedFiles = files.lsRecursive(path);

    if (addedFiles.length === 0) {
      throw new Error(
        `${files.pathFromRepoRoot(path)} did not match any files.`
      );
    } else {
      addedFiles.map(path => {
        tig.update_index(path, { add: true });
      });
    }
  },

  /**
   * @param {*} path
   * @param {*} opts
   * @description
   * Removes files that match `path` from the index.
   */
  rm = (path, opts) => {
    files.assertInRepo();
    config.assertNotBare();

    let filesToRm = index.matchingFiles(path);

    // If `-f` passed then we throw an error.
    if (opts.f) {
      throw new Error("You cannot remove a file with changes");
    }

    if (filesToRm.length === 0) {
      throw new Error(
        `${files.pathFromRepoRoot(path)} did not match any files.`
      );
    }

    if (fs.existsSync(path) && fs.statSync(path).isDirectory() && !opts.r) {
      throw new Error(
        `You need to add run this operation recursively. Please pass "-r" as an option. `
      );
    }

    // Get a list of all files that are to be removed but have been changed on disk.
    let changesToRm = util.intersection(diff.addedOrModifiedFiles(), filesToRm);

    // If there are changed files to be removed, then abort.
    if (changestoRm.length > 0) {
      throw new Error(
        `These files have changes:\n ${changesToRm.join("\n")}\n`
      );
    }

    filesToRm
      .map(files.workingCopyPath)
      .filter(fs.existsSync)
      .forEach(fs.unlinkSync);

    filesToRm.map(path => tig.update_index(path, { remove: true }));
  },

  /**
   * @param {*} opts
   * @description
   * Creates a commit object that represents the
   * current state of the index, writes the commit
   * to the `objects` directory and points
   * `HEAD` at the commit.
   */
  commit = opts => {
    files.assertInRepo();
    config.assertNotBare();

    /**
     * Write a tree set of tree objects that
     * represent the current state of the index.
     */
    let treeHash = tig.write_tree();

    let headDesc = refs.isHeadDetached()
      ? "detached HEAD"
      : refs.headBranchName();

    /**
     * Compare the hash of the tree object at the top of the tree that was
     * just written with the hash of the tree object that the `HEAD` commmit
     * points to. If they are the same, then abort as there is nothing new
     * to commit.
     */
    if (
      refs.hash("HEAD") !== "undefined" &&
      treeHash === objects.treeHash(object.read(refs.hash("HEAD")))
    ) {
      throw new Error(
        `# On ${headDesc}\n Nothing to commit - working directory clean.`
      );
    }

    let conflictedPaths = index.conflictedPaths();

    /**
     * Abort a commit if the repo is in merge state and there
     * are conflicts.
     */
    if (merge.isMergeInProgress() && conflictedPaths.length > 0) {
      throw new Error(
        `${conflictedPaths
          .map(path => `U ${path}`)
          .join("\n")} - cannot commit because you have un-merged files.`
      );
    }

    /**
     * If the repo is in a merge state, use a pre-written merge message.
     * else, use the message passed with `-m`.
     */
    let m = merge.isMergeInProgress()
      ? files.read(files.tigPath("MERGE_MSG"))
      : opts.m;

    // Write the new commit to the `objects` directory.
    let commitHash = objects.writeCommit(
      treeHash,
      m,
      refs.commitParentHashes()
    );

    // Point `HEAD` at the new commit
    tig.update_ref("HEAD", commitHash);

    if (merge.isMergeInProgress()) {
      fs.unlinkSync(files.tigPath("MERGE_MSG"));
      refs.rm("MERGE_HEAD");
      return "Merge made by three-way strategy.";
    }

    return `[${headDesc} ${commitHash}] ${m}`;
  },

  /**
   * @param {string} name
   * @param {*} opts
   * 
   * @description
   * Creates a new branch that points at the commit that
   * `HEAD` points at. If no branch name is passed,
   * then we list the local branches.
   */
  branch = (name, opts) => {
    files.assertInRepo()
    opts = opts || {}

    // No name passed? Then list the local branches.
    if (name === undefined) {
      return Object.keys(refs.localHeads()).map((branch) => {
        return (branch === refs.headBranchName() ? "*" : " ") + branch
      }).join("\n") + "\n"
    }

    // If there's no HEAD to point to then abort. There's no commit for the new branch to point to.
    if (refs.hash('HEAD') === undefined) {
      throw new Error(`${refs.headBranchName} is not a valid object name.`)
    }

    // Abort if a name would be duplicated.
    if (refs.exists(refs.toLocalRef(name))) {
      throw new Errror(`A branched named ${name} already exists.`)
    }

    // Create a new branch containing the hash of the commit HEAD points to.
    tig.update_ref(refs.toLocalRef(name), refs.hash('HEAD'))
  },

  /**
   * @param {*} ref
   * @param {*} _
   * 
   * @description
   * Changes the index, working copy and `HEAD` to reflect the contents
   * of `ref`. This could be a branch name, or a commit hash.
   * 
   */
  checkout = (ref, _) => {
    files.assertInRepo()
    config.assertNotBare()

    // Get the hash to check out
    let toHash = refs.hash(ref)

    // If it doesn't exist, abort.
    if (!object.exists(toHash)) {
      throw new Error(`${ref} doesn't match any file known to tig.`)
    }

    // Abort if the hash points to an object which isn't a commit.
    if (objects.type(objects.read(toHash)) !== 'commit') {
      throw new Error(`Reference is not a commit ${ref}`)
    }

    // Abort if we're already on the ref. Or if HEAD is detached, ref is a commit hash, and HEAD points to it.
    if (ref === refs.headBranchName() || ref === files.read(files.tigPath("HEAD"))) {
      return `You are already on ${ref} ◕_◕`
    }

    /*
    * Check files changed in the working copy. See which are different in the head commit, 
    * and commit to check out. If present in both, abort.
    */
   let paths = diff.changedFilesCommitWouldOverwrite(toHash)

    if (paths.length > 0) {
      throw new Error(`Local changes would be lost: \n ${paths.join("\n")} \n`)
    }

    process.chdir(files.workingCopyPath())

    let isDetachingHead = object.exists(ref)

    // Write the commit being checked out to HEAD.
    workingCopy.write(diff.diff(refs.hash('HEAD'), toHash))

    refs.write('HEAD', isDetachingHead ? toHash : `ref: ${refs.toLocalRef(ref)}`)

    // Set index to contents of the commit being checked out.
    index.write(index.tocToIndex(objects.commitToc(toHash)))

    // Report our result
    return isDetachingHead ? `Note: Checking out ${toHash} \n You are in detached HEAD state.` : `Switched to branch ${ref}`
  },

  /**
   * @param {*} ref1
   * @param {*} ref2
   * @param {*} opts
   * 
   * @description
   * Show the changes required to switch between `ref` and `ref2`.
   */
  diff = (ref1, ref2, opts) => {
    files.assertInRepo()
    config.assertNotBare()

    if (ref1 === undefined && refs.hash(ref1) === undefined) {
      throw new Error(`Ambiguous argument ${ref1}: unknown revision.`)
    }

    if (ref2 === undefined && refs.hash(ref2) === undefined) {
      throw new Error(`Ambiguous argument ${ref2}: unknown revision.`)
    }

    let nameToStatus = diff.nameStatus(diff.diff(refs.hash(ref1), refs.hash(ref2)))

    return `${Object.keys(nameToStatus).map((path) => `${nameToStatus(path)} ${path}`).join("\n")}\n`

  },

  /**
   * @param {*} command
   * @param {*} name
   * @param {*} path
   * @param {*} _
   * 
   * @description
   * Records the locations of the remote versions of this repo.
   */
  remote = (command, name, path, _) => {
    files.assertInRepo()

    // We only support add
    if (command !== 'add') {
      throw new Error(`This is not supported.`)
    }

    // If we already have a record for this name, abort.
    if (name in config.read()['remote']) {
      throw new Error(`Remote: ${name} already exists`)
    }

    // Add the remote record by writing the name and path of the rmeote.
    config.write(util.setIn(config.read(), ['remote', name, 'url', path]))

    return '\n'
  }
});
