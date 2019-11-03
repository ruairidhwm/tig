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
  }
});
