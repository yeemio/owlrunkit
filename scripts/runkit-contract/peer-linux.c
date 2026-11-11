// SPDX-License-Identifier: GPL-3.0-or-later
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/xattr.h>
#include <unistd.h>

// ABI 3 added this bit. The runtime still checks that the kernel supports it.
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

#if defined(__aarch64__)
#define NATIVE_AUDIT_ARCH AUDIT_ARCH_AARCH64
#define GLIBC_LOADER "/lib/ld-linux-aarch64.so.1"
#define MUSL_LOADER "/lib/ld-musl-aarch64.so.1"
#elif defined(__x86_64__) && !defined(__ILP32__)
#define NATIVE_AUDIT_ARCH AUDIT_ARCH_X86_64
#define GLIBC_LOADER "/lib64/ld-linux-x86-64.so.2"
#define MUSL_LOADER "/lib/ld-musl-x86_64.so.1"
#else
#error Unsupported OwlRunKit peer architecture
#endif

extern char **environ;

static void fail(const char *operation)
{
    perror(operation);
    _exit(125);
}

static void allow_path(int ruleset, const char *path, uint64_t rights, int optional)
{
    int fd = open(path, O_PATH | O_CLOEXEC);
    if (fd < 0) {
        if (optional && errno == ENOENT)
            return;
        fail(path);
    }
    struct landlock_path_beneath_attr rule = { .allowed_access = rights, .parent_fd = fd };
    if (syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0) < 0)
        fail("landlock_add_rule");
    close(fd);
}

static void restrict_files(const char *directory, const char *worker)
{
    const uint64_t read_tree = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
    const uint64_t work = read_tree | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE |
        LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
        LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REFER;
    const struct landlock_ruleset_attr rules = { .handled_access_fs = work |
        LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_BLOCK |
        LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_SYM };
    long abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
    if (abi < 0)
        fail("landlock_create_ruleset version");
    if (abi < 3) {
        errno = EOPNOTSUPP;
        fail("Landlock ABI 3 is required");
    }
    int fd = syscall(SYS_landlock_create_ruleset, &rules, sizeof rules, 0);
    if (fd < 0)
        fail("landlock_create_ruleset");
    if (worker) {
        allow_path(fd, directory, work, 0);
        allow_path(fd, worker, LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE, 0);
        allow_path(fd, "/lib", read_tree, 1);
        allow_path(fd, "/lib64", read_tree, 1);
        allow_path(fd, "/usr/lib", read_tree, 1);
        allow_path(fd, "/usr/lib64", read_tree, 1);
        allow_path(fd, GLIBC_LOADER, LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE, 1);
        allow_path(fd, MUSL_LOADER, LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_EXECUTE, 1);
        allow_path(fd, "/etc/ld.so.cache", LANDLOCK_ACCESS_FS_READ_FILE, 1);
        allow_path(fd, "/dev/null", LANDLOCK_ACCESS_FS_READ_FILE, 1);
    }
    if (syscall(SYS_landlock_restrict_self, fd, 0) < 0)
        fail("landlock_restrict_self");
    close(fd);
}

#define ALLOW_SYSCALL(name) \
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_##name, 0, 1), \
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
#define DENIED (SECCOMP_RET_ERRNO | EPERM)

static void restrict_syscalls(void)
{
    const unsigned thread_flags = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD |
        CLONE_SYSVSEM | CLONE_SETTLS | CLONE_PARENT_SETTID | CLONE_CHILD_CLEARTID | CLONE_CHILD_SETTID;
    const unsigned pid = (unsigned)getpid();
    struct sock_filter instructions[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, NATIVE_AUDIT_ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),

        // glibc retries via clone when clone3 is unavailable. Its pointer
        // arguments cannot be safely checked by a seccomp BPF program.
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 6),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, CLONE_THREAD, 0, 3),
        BPF_STMT(BPF_ALU | BPF_AND | BPF_K, ~thread_flags),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_STMT(BPF_RET | BPF_K, DENIED),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_tgkill, 0, 4),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, pid, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_STMT(BPF_RET | BPF_K, DENIED),

        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_ioctl, 0, 6),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FIONBIO, 3, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FIONREAD, 2, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, TCGETS, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, DENIED),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),

        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_fcntl, 0, 11),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, F_GETFD, 8, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, F_SETFD, 7, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, F_GETFL, 6, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, F_DUPFD, 5, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, F_DUPFD_CLOEXEC, 4, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, F_SETFL, 0, 2),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
        BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, O_ASYNC, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, DENIED),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),

        // Data and path operations below are subject to Landlock. Operations
        // it cannot confine, such as chmod and xattrs, stay denied.
        ALLOW_SYSCALL(execve),
        ALLOW_SYSCALL(read), ALLOW_SYSCALL(write), ALLOW_SYSCALL(readv), ALLOW_SYSCALL(writev),
        ALLOW_SYSCALL(pread64), ALLOW_SYSCALL(pwrite64), ALLOW_SYSCALL(lseek), ALLOW_SYSCALL(close),
        ALLOW_SYSCALL(openat), ALLOW_SYSCALL(fstat), ALLOW_SYSCALL(newfstatat), ALLOW_SYSCALL(statx),
        ALLOW_SYSCALL(faccessat), ALLOW_SYSCALL(faccessat2), ALLOW_SYSCALL(getdents64),
        ALLOW_SYSCALL(getcwd), ALLOW_SYSCALL(chdir), ALLOW_SYSCALL(fchdir), ALLOW_SYSCALL(readlinkat),
        ALLOW_SYSCALL(mkdirat), ALLOW_SYSCALL(unlinkat), ALLOW_SYSCALL(renameat),
        ALLOW_SYSCALL(renameat2), ALLOW_SYSCALL(linkat), ALLOW_SYSCALL(symlinkat),
        ALLOW_SYSCALL(truncate), ALLOW_SYSCALL(ftruncate), ALLOW_SYSCALL(fsync), ALLOW_SYSCALL(fdatasync),
        ALLOW_SYSCALL(dup), ALLOW_SYSCALL(dup3), ALLOW_SYSCALL(pipe2),
        ALLOW_SYSCALL(mmap), ALLOW_SYSCALL(munmap), ALLOW_SYSCALL(mprotect), ALLOW_SYSCALL(mremap),
        ALLOW_SYSCALL(madvise), ALLOW_SYSCALL(brk),
        ALLOW_SYSCALL(rt_sigaction), ALLOW_SYSCALL(rt_sigprocmask), ALLOW_SYSCALL(rt_sigreturn),
        ALLOW_SYSCALL(sigaltstack), ALLOW_SYSCALL(getpid), ALLOW_SYSCALL(getppid), ALLOW_SYSCALL(gettid),
        ALLOW_SYSCALL(getuid), ALLOW_SYSCALL(geteuid), ALLOW_SYSCALL(getgid), ALLOW_SYSCALL(getegid),
        ALLOW_SYSCALL(getgroups), ALLOW_SYSCALL(uname), ALLOW_SYSCALL(sysinfo),
        ALLOW_SYSCALL(set_tid_address), ALLOW_SYSCALL(set_robust_list), ALLOW_SYSCALL(rseq),
        ALLOW_SYSCALL(getrandom), ALLOW_SYSCALL(futex), ALLOW_SYSCALL(sched_yield),
        ALLOW_SYSCALL(sched_getaffinity), ALLOW_SYSCALL(clock_gettime),
        ALLOW_SYSCALL(clock_nanosleep), ALLOW_SYSCALL(nanosleep), ALLOW_SYSCALL(gettimeofday),
        ALLOW_SYSCALL(epoll_create1), ALLOW_SYSCALL(epoll_ctl), ALLOW_SYSCALL(epoll_pwait),
        ALLOW_SYSCALL(epoll_pwait2), ALLOW_SYSCALL(eventfd2), ALLOW_SYSCALL(ppoll),
        ALLOW_SYSCALL(getsockname), ALLOW_SYSCALL(getpeername), ALLOW_SYSCALL(getsockopt),
        ALLOW_SYSCALL(getrlimit), ALLOW_SYSCALL(exit), ALLOW_SYSCALL(exit_group),
#ifdef __x86_64__
        ALLOW_SYSCALL(arch_prctl), ALLOW_SYSCALL(access), ALLOW_SYSCALL(open),
        ALLOW_SYSCALL(stat), ALLOW_SYSCALL(lstat), ALLOW_SYSCALL(readlink),
        ALLOW_SYSCALL(mkdir), ALLOW_SYSCALL(rmdir), ALLOW_SYSCALL(unlink),
        ALLOW_SYSCALL(rename), ALLOW_SYSCALL(link), ALLOW_SYSCALL(symlink),
        ALLOW_SYSCALL(dup2), ALLOW_SYSCALL(pipe), ALLOW_SYSCALL(epoll_wait), ALLOW_SYSCALL(poll),
#endif
        BPF_STMT(BPF_RET | BPF_K, DENIED),
    };
    const struct sock_fprog filter = {
        .len = sizeof instructions / sizeof instructions[0], .filter = instructions,
    };
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &filter) < 0)
        fail("seccomp filter");
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "lock") == 0) {
        if (flock(3, LOCK_EX | LOCK_NB) == 0)
            return 0;
        if (errno == EWOULDBLOCK)
            return 73;
        fail("control flock");
    }
    int probe = argc == 2 && strcmp(argv[1], "probe") == 0;
    if (!probe && (argc < 5 || strcmp(argv[1], "run") != 0))
        return 125;
    if (!probe) {
        char *end;
        long parent = strtol(argv[2], &end, 10);
        if (*end || parent <= 0 || prctl(PR_SET_PDEATHSIG, SIGKILL) < 0 || getppid() != parent)
            return 125;
        struct stat worker;
        if (stat(argv[4], &worker) < 0)
            fail("stat worker");
        if (worker.st_mode & (S_ISUID | S_ISGID)) {
            errno = EPERM;
            fail("set-id workers are unsupported");
        }
        if (getxattr(argv[4], "security.capability", NULL, 0) >= 0) {
            errno = EPERM;
            fail("file capabilities on workers are unsupported");
        }
        if (errno != ENODATA && errno != ENOTSUP)
            fail("getxattr worker capabilities");
    }
    if (syscall(SYS_close_range, 3U, ~0U, 0) < 0)
        fail("close inherited descriptors");
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0)
        fail("no_new_privs");
    restrict_files(probe ? NULL : argv[3], probe ? NULL : argv[4]);
    restrict_syscalls();
    if (probe) {
        if (open("/etc/passwd", O_RDONLY) >= 0 || errno != EACCES ||
            socket(AF_INET, SOCK_STREAM, 0) >= 0 || errno != EPERM) {
            fputs("Linux peer enforcement self-test failed\n", stderr);
            return 125;
        }
        return 0;
    }
    execve(argv[4], &argv[4], environ);
    fail("execve worker");
}
