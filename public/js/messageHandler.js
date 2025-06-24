// 消息处理逻辑

const MessageHandler = {
    // 自动刷新定时器
    autoRefreshTimer: null,

    // 消息缓存（用于检测变化）
    lastMessages: [],

    // 加载状态（防止重复请求）
    isLoading: false,
    isLoadingMore: false,

    // 分页状态
    hasMoreMessages: true, // 是否还有更多历史消息
    totalLoadedMessages: 0, // 已加载的消息总数

    // 无限滚动相关
    scrollListener: null, // 滚动监听器
    scrollDebounceTimer: null, // 防抖定时器
    isScrollListenerActive: false, // 滚动监听器是否激活

    // 初始化消息处理
    init() {
        this.bindEvents();

        // 初始化实时通信
        this.initRealtime();

        // 直接加载消息，不显示加载状态
        this.loadMessages(true); // 初始加载时强制滚动
        this.syncDevice();

        // 初始化无限滚动
        this.initInfiniteScroll();

        // 如果实时连接失败，启用轮询
        setTimeout(() => {
            if (!window.Realtime || !window.Realtime.isConnectionAlive()) {
                this.startAutoRefresh();
            }
        }, 2000);
    },

    // 初始化实时通信
    initRealtime() {
        // 检查是否支持SSE
        if (typeof EventSource === 'undefined') {
            this.startAutoRefresh();
            return;
        }

        const deviceId = Utils.getDeviceId();

        // 初始化实时连接
        if (window.Realtime) {
            Realtime.init(deviceId);

            // 监听实时事件
            Realtime.on('connected', () => {
                this.stopAutoRefresh();
            });

            Realtime.on('disconnected', () => {
                this.startAutoRefresh();
            });

            Realtime.on('newMessages', (data) => {
                // 立即加载消息，强制滚动到底部
                this.loadMessages(true);
            });
        } else {
            this.startAutoRefresh();
        }
    },
    
    // 绑定事件
    bindEvents() {
        const messageForm = document.getElementById('messageForm');
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });
    },
    
    // 加载消息列表
    async loadMessages(forceScroll = false) {
        // 防止重复请求
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;

        try {
            const messages = await API.getMessages();

            // 检测消息变化
            const hasChanges = this.detectMessageChanges(messages);

            // 总是更新UI，即使没有变化（首次加载时需要显示最终状态）
            const isFirstLoad = this.lastMessages.length === 0;
            if (hasChanges || forceScroll || isFirstLoad) {
                // 智能滚动逻辑：
                // 1. 强制滚动时总是滚动
                // 2. 有新消息且用户在底部时滚动
                // 3. 初次加载时滚动
                const userAtBottom = UI.isAtBottom();
                const shouldScroll = forceScroll || (hasChanges && userAtBottom) || isFirstLoad;

                UI.renderMessages(messages, shouldScroll);

                // 更新缓存和分页状态
                this.lastMessages = [...messages];
                this.totalLoadedMessages = messages.length;

                // 判断是否还有更多消息
                this.hasMoreMessages = messages.length >= CONFIG.UI.MESSAGE_LOAD_LIMIT;

                // 启动或停止无限滚动监听
                this.updateInfiniteScrollState();
            }

        } catch (error) {
            console.error('加载消息失败:', error);

            // 如果是首次加载失败，静默处理，显示空状态
            if (this.lastMessages.length === 0) {
                UI.showEmpty('还没有消息，开始聊天吧！');
            } else {
                // 非首次加载失败时才显示错误提示
                UI.showError(error.message || CONFIG.ERRORS.LOAD_MESSAGES_FAILED);
            }
        } finally {
            this.isLoading = false;
        }
    },

    // 初始化无限滚动
    initInfiniteScroll() {
        const messageContainer = UI.getMessageContainer();
        if (!messageContainer) {
            console.warn('消息容器未找到，无法初始化无限滚动');
            return;
        }

        // 创建滚动监听器
        this.scrollListener = this.createScrollListener();

        // 初始状态检查
        this.updateInfiniteScrollState();
    },

    // 创建滚动监听器（带防抖）
    createScrollListener() {
        return (event) => {
            // 清除之前的防抖定时器
            if (this.scrollDebounceTimer) {
                clearTimeout(this.scrollDebounceTimer);
            }

            // 设置防抖延迟
            this.scrollDebounceTimer = setTimeout(() => {
                this.handleScroll(event);
            }, CONFIG.UI.SCROLL_DEBOUNCE_DELAY);
        };
    },

    // 处理滚动事件
    async handleScroll(event) {
        // 如果正在加载或没有更多消息，直接返回
        if (this.isLoadingMore || !this.hasMoreMessages) {
            return;
        }

        const container = event.target;
        const scrollTop = container.scrollTop;
        const threshold = CONFIG.UI.INFINITE_SCROLL_THRESHOLD;

        // 检查是否接近顶部
        if (scrollTop <= threshold) {
            await this.loadMoreMessagesInfinite();
        }
    },

    // 无限滚动加载更多消息
    async loadMoreMessagesInfinite() {
        // 防止重复请求
        if (this.isLoadingMore || !this.hasMoreMessages) {
            return;
        }

        this.isLoadingMore = true;
        UI.showTopLoadingIndicator(true); // 显示顶部加载指示器

        try {
            // 获取当前滚动位置
            const scrollContainer = UI.getMessageContainer();
            const oldScrollHeight = scrollContainer.scrollHeight;
            const oldScrollTop = scrollContainer.scrollTop;

            // 加载更多消息
            const moreMessages = await API.getMessages(
                CONFIG.UI.LOAD_MORE_BATCH_SIZE,
                this.totalLoadedMessages
            );

            if (moreMessages && moreMessages.length > 0) {
                // 合并消息（新加载的历史消息在前面）
                const allMessages = [...moreMessages, ...this.lastMessages];

                // 更新UI（不滚动）
                UI.renderMessages(allMessages, false);

                // 更新缓存和状态
                this.lastMessages = allMessages;
                this.totalLoadedMessages += moreMessages.length;

                // 判断是否还有更多消息
                this.hasMoreMessages = moreMessages.length >= CONFIG.UI.LOAD_MORE_BATCH_SIZE;

                // 精确恢复滚动位置
                requestAnimationFrame(() => {
                    const newScrollHeight = scrollContainer.scrollHeight;
                    const scrollDiff = newScrollHeight - oldScrollHeight;
                    scrollContainer.scrollTop = oldScrollTop + scrollDiff;
                });
            } else {
                // 没有更多消息了
                this.hasMoreMessages = false;
            }

            // 更新无限滚动状态
            this.updateInfiniteScrollState();

        } catch (error) {
            console.error('无限滚动加载失败:', error);
            // 静默处理错误，不显示错误提示
        } finally {
            this.isLoadingMore = false;
            UI.showTopLoadingIndicator(false); // 隐藏加载指示器
        }
    },

    // 更新无限滚动状态
    updateInfiniteScrollState() {
        const messageContainer = UI.getMessageContainer();
        if (!messageContainer) return;

        if (this.hasMoreMessages && !this.isScrollListenerActive) {
            // 启动滚动监听
            messageContainer.addEventListener('scroll', this.scrollListener, { passive: true });
            this.isScrollListenerActive = true;
        } else if (!this.hasMoreMessages && this.isScrollListenerActive) {
            // 停止滚动监听
            messageContainer.removeEventListener('scroll', this.scrollListener);
            this.isScrollListenerActive = false;
        }
    },

    // 清理无限滚动
    cleanupInfiniteScroll() {
        const messageContainer = UI.getMessageContainer();
        if (messageContainer && this.scrollListener) {
            messageContainer.removeEventListener('scroll', this.scrollListener);
        }

        if (this.scrollDebounceTimer) {
            clearTimeout(this.scrollDebounceTimer);
            this.scrollDebounceTimer = null;
        }

        this.isScrollListenerActive = false;
    },

    // 检测消息变化
    detectMessageChanges(newMessages) {
        // 如果数量不同，肯定有变化
        if (newMessages.length !== this.lastMessages.length) {
            return true;
        }

        // 检查每条消息的ID和时间戳
        for (let i = 0; i < newMessages.length; i++) {
            const newMsg = newMessages[i];
            const oldMsg = this.lastMessages[i];

            if (!oldMsg || newMsg.id !== oldMsg.id || newMsg.timestamp !== oldMsg.timestamp) {
                return true;
            }
        }

        return false;
    },
    
    // 发送文本消息
    async sendMessage() {
        const content = UI.getInputValue();

        if (!content) {
            return;
        }

        // 检查是否为AI消息
        if (this.isAIMessage(content)) {
            await this.handleAIMessage(content);
            return;
        }

        // 检查是否为清理指令
        if (this.isClearCommand(content)) {
            await this.handleClearCommand();
            return;
        }

        // 检查是否为登出指令
        if (this.isLogoutCommand(content)) {
            await this.handleLogoutCommand();
            return;
        }

        // 检查是否为PWA指令
        if (this.isPWACommand(content)) {
            await this.handlePWACommand();
            return;
        }

        try {
            UI.setSendButtonState(true, true);
            UI.setConnectionStatus('connecting');

            const deviceId = Utils.getDeviceId();
            await API.sendMessage(content, deviceId);

            // 清空输入框
            UI.clearInput();

            // 立即重新加载消息（发送消息后强制滚动到底部）
            await this.loadMessages(true);

            // 多次延迟加载，确保消息显示
            setTimeout(async () => {
                await this.loadMessages(true);
            }, 200);

            setTimeout(async () => {
                await this.loadMessages(true);
            }, 800);

            setTimeout(async () => {
                await this.loadMessages(true);
            }, 1500);

            UI.showSuccess(CONFIG.SUCCESS.MESSAGE_SENT);
            UI.setConnectionStatus('connected');

        } catch (error) {
            console.error('发送消息失败:', error);
            UI.showError(error.message || CONFIG.ERRORS.MESSAGE_SEND_FAILED);
            UI.setConnectionStatus('disconnected');
        } finally {
            UI.setSendButtonState(false, false);
        }
    },

    // 检查是否为AI消息
    isAIMessage(content) {
        // 检查AI模式或消息内容
        if (window.AIHandler && AIHandler.isAIMode) {
            return true;
        }

        // 检查消息是否以AI标识开头
        const trimmedContent = content.trim();
        return trimmedContent.startsWith('🤖') ||
               trimmedContent.toLowerCase().startsWith('ai:') ||
               trimmedContent.toLowerCase().startsWith('ai ');
    },

    // 处理AI消息
    async handleAIMessage(content) {

        // 清空输入框
        UI.clearInput();

        // 检查AI模块是否可用
        if (!window.AIHandler) {
            UI.showError('AI模块未加载，请刷新页面重试');
            return;
        }

        // 分发beforeMessageSend事件，让AI处理器接管
        const event = new CustomEvent('beforeMessageSend', {
            detail: { content },
            cancelable: true
        });

        document.dispatchEvent(event);

        // 如果事件被取消，说明AI处理器已接管
        if (event.defaultPrevented) {
            return;
        }

        // 如果AI处理器没有接管，直接调用AI处理
        if (typeof AIHandler.handleAIMessage === 'function') {
            await AIHandler.handleAIMessage(content);
        } else {
            UI.showError('AI功能暂时不可用');
        }
    },

    // 检查是否为清理指令
    isClearCommand(content) {
        const trimmedContent = content.trim().toLowerCase();
        return CONFIG.CLEAR.TRIGGER_COMMANDS.some(cmd =>
            trimmedContent === cmd.toLowerCase()
        );
    },

    // 检查是否为登出指令
    isLogoutCommand(content) {
        const trimmedContent = content.trim().toLowerCase();
        const logoutCommands = ['/logout', '/登出', 'logout', '登出'];
        return logoutCommands.includes(trimmedContent);
    },

    // 检查是否为PWA指令
    isPWACommand(content) {
        const trimmedContent = content.trim().toLowerCase();
        return CONFIG.PWA.TRIGGER_COMMANDS.includes(trimmedContent);
    },

    // 处理清理指令
    async handleClearCommand() {
        // 清空输入框
        UI.clearInput();

        // 显示确认对话框
        const userConfirmed = confirm(CONFIG.CLEAR.CONFIRM_MESSAGE);

        if (!userConfirmed) {
            UI.showError(CONFIG.ERRORS.CLEAR_CANCELLED);
            return;
        }

        // 获取用户输入的确认码
        const confirmCode = prompt('请输入确认码：');

        if (confirmCode !== CONFIG.CLEAR.CONFIRM_CODE) {
            UI.showError('确认码错误，数据清理已取消');
            return;
        }

        try {
            UI.setSendButtonState(true, true);
            UI.setConnectionStatus('connecting');

            // 执行清理操作
            const result = await API.clearAllData(confirmCode);

            // 清空前端界面
            UI.showEmpty('数据已清空，开始新的聊天吧！');
            this.lastMessages = [];

            // 显示清理结果
            const resultMessage = `✅ 数据清理完成！\n\n📊 清理统计：\n• 删除消息：${result.deletedMessages} 条\n• 删除文件：${result.deletedFiles} 个\n• 释放空间：${Utils.formatFileSize(result.deletedFileSize)}\n• R2文件：${result.deletedR2Files} 个`;

            UI.showSuccess(resultMessage);
            UI.setConnectionStatus('connected');

        } catch (error) {
            console.error('数据清理失败:', error);
            UI.showError(error.message || CONFIG.ERRORS.CLEAR_FAILED);
            UI.setConnectionStatus('disconnected');
        } finally {
            UI.setSendButtonState(false, false);
        }
    },

    // 处理登出指令
    async handleLogoutCommand() {
        // 清空输入框
        UI.clearInput();

        // 显示确认对话框
        const userConfirmed = confirm('确定要登出吗？登出后需要重新输入密码才能访问。');

        if (!userConfirmed) {
            UI.showError('登出已取消');
            return;
        }

        try {
            // 显示登出提示
            UI.showSuccess('正在登出...');

            // 延迟一下让用户看到提示
            setTimeout(() => {
                // 执行登出操作
                Auth.logout();
            }, 1000);

        } catch (error) {
            console.error('登出失败:', error);
            UI.showError('登出失败，请重试');
        }
    },

    // 处理PWA指令
    async handlePWACommand() {
        // 清空输入框
        UI.clearInput();

        try {
            // 检查PWA支持和状态
            if (typeof PWA === 'undefined') {
                UI.showError('PWA功能不可用');
                return;
            }

            const pwaStatus = await PWA.getStatus();

            // 检查是否已安装
            if (pwaStatus.installed) {
                UI.showSuccess(`📱 应用已安装\n\n✅ 当前运行在独立模式\n🚀 享受原生应用体验！`);
                return;
            }

            // 检查是否可以安装
            if (pwaStatus.installPromptAvailable) {
                // 构建安装好处列表
                const benefits = CONFIG.PWA.INSTALL_BENEFITS.map(benefit => `• ${benefit}`).join('\n');

                // 显示安装确认
                const userConfirmed = confirm(`🚀 检测到可以安装微信文件传输助手到桌面！\n\n📱 安装后可以：\n${benefits}\n\n确定要安装吗？`);

                if (userConfirmed) {
                    // 触发安装
                    await PWA.promptInstall();
                } else {
                    UI.showSuccess('安装已取消\n\n💡 提示：随时输入 /pwa 可以重新安装');
                }
            } else {
                // 显示PWA状态和安装指南
                let statusMessage = '📱 PWA应用状态\n\n';

                if (pwaStatus.serviceWorkerRegistered) {
                    statusMessage += '✅ Service Worker: 已注册\n';
                } else {
                    statusMessage += '❌ Service Worker: 未注册\n';
                }

                if (pwaStatus.manifestAccessible) {
                    statusMessage += '✅ 应用清单: 可访问\n';
                } else {
                    statusMessage += '❌ 应用清单: 不可访问\n';
                }

                statusMessage += `💾 缓存数量: ${pwaStatus.cacheCount || 0}\n\n`;

                // 添加安装指南
                statusMessage += '📖 手动安装指南：\n\n';
                statusMessage += '🤖 Android (Chrome):\n';
                statusMessage += '• 地址栏右侧点击安装图标\n';
                statusMessage += '• 或菜单 → "安装应用"\n\n';
                statusMessage += '🍎 iPhone (Safari):\n';
                statusMessage += '• 点击分享按钮 📤\n';
                statusMessage += '• 选择"添加到主屏幕"\n\n';
                statusMessage += '💻 桌面 (Chrome/Edge):\n';
                statusMessage += '• 地址栏右侧安装图标\n';
                statusMessage += '• 或菜单 → "安装wxchat"';

                UI.showSuccess(statusMessage);
            }

        } catch (error) {
            console.error('PWA指令处理失败:', error);
            UI.showError('PWA功能检查失败，请重试');
        }
    },
    
    // 设备同步
    async syncDevice() {
        try {
            const deviceId = Utils.getDeviceId();
            const deviceName = Utils.getDeviceType();
            
            const success = await API.syncDevice(deviceId, deviceName);
            
            if (success) {
                // 设备同步成功
            }
            
        } catch (error) {
            console.error('设备同步失败:', error);
            // 设备同步失败不影响应用正常使用
        }
    },
    
    // 开始自动刷新
    startAutoRefresh() {
        // 清除现有定时器
        this.stopAutoRefresh();
        
        // 设置新的定时器
        this.autoRefreshTimer = setInterval(() => {
            this.loadMessages();
        }, CONFIG.UI.AUTO_REFRESH_INTERVAL);
        
        // 自动刷新已启动
    },
    
    // 停止自动刷新
    stopAutoRefresh() {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
            // 自动刷新已停止
        }
    },
    
    // 重启自动刷新
    restartAutoRefresh() {
        this.stopAutoRefresh();
        this.startAutoRefresh();
    },
    
    // 处理页面可见性变化
    handleVisibilityChange() {
        if (document.hidden) {
            // 页面隐藏时停止自动刷新
            this.stopAutoRefresh();
        } else {
            // 页面显示时重启自动刷新并立即刷新一次（不强制滚动）
            this.startAutoRefresh();
            this.loadMessages(false);
        }
    },
    
    // 处理网络状态变化
    handleOnlineStatusChange() {
        if (navigator.onLine) {
            UI.setConnectionStatus('connected');
            this.restartAutoRefresh();
            this.loadMessages(false); // 网络恢复时不强制滚动
        } else {
            UI.setConnectionStatus('disconnected');
            this.stopAutoRefresh();
            // 网络断开通知已禁用，避免移动端弹窗遮挡输入框
            // UI.showError('网络连接已断开');
        }
    },
    
    // 添加新消息到列表（用于实时更新）
    addNewMessage(message) {
        UI.addMessage(message);
    },
    
    // 清空所有消息
    clearAllMessages() {
        UI.showEmpty('消息已清空');
    },
    
    // 搜索消息（预留功能）
    searchMessages(keyword) {
        // 预留：消息搜索功能
    },

    // 导出消息（预留功能）
    exportMessages() {
        // 预留：消息导出功能
    }
};

// 监听页面可见性变化
document.addEventListener('visibilitychange', () => {
    MessageHandler.handleVisibilityChange();
});

// 监听网络状态变化
window.addEventListener('online', () => {
    MessageHandler.handleOnlineStatusChange();
});

window.addEventListener('offline', () => {
    MessageHandler.handleOnlineStatusChange();
});

// 页面卸载时清理定时器和无限滚动
window.addEventListener('beforeunload', () => {
    MessageHandler.stopAutoRefresh();
    MessageHandler.cleanupInfiniteScroll();
});
