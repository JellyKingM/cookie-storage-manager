chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;

  chrome.system.display.getInfo((displays) => {
    const primaryDisplay = displays.find(d => d.isPrimary) || displays[0];
    
    const screenWidth = primaryDisplay.workArea.width;
    const screenHeight = primaryDisplay.workArea.height;

    const width = Math.round(screenWidth * 0.6);
    const height = Math.round(screenHeight * 0.5);

    const left = Math.round((screenWidth - width) / 2);
    const top = Math.round((screenHeight - height) / 2);

    chrome.windows.create({
      url: `popup.html?tabId=${tab.id}`,
      type: 'popup',
      width: width,
      height: height,
      left: left,
      top: top
    });
  });
});
