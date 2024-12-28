/* eslint-disable no-mixed-spaces-and-tabs */
import { EditorView } from '@codemirror/view';
import { TransactionSpec } from '@codemirror/state';
import {
	Editor,
	FrontMatterCache,
	Notice,
	Plugin,
	TFile,
	View,
	addIcon,
	getAllTags,
} from 'obsidian';
import * as graph from 'pagerank.js';
import 'tippy.js/dist/tippy.css';
import { CardScheduleCalculator } from './CardSchedule';
import { Deck, DeckTreeFilter } from './Deck';
import {
	CardListOrder,
	DeckTreeIterator,
	IDeckTreeIterator,
	IIteratorOrder,
	IteratorDeckSource,
	OrderMethod,
} from './DeckTreeIterator';
import {
	FlashcardReviewMode,
	FlashcardReviewSequencer,
	IFlashcardReviewSequencer,
} from './FlashcardReviewSequencer';
import { Note } from './Note';
import { NoteEaseCalculator } from './NoteEaseCalculator';
import { NoteEaseList } from './NoteEaseList';
import { NoteFileLoader } from './NoteFileLoader';
import { QuestionPostponementList } from './QuestionPostponementList';
import { ReviewDeck, ReviewDeckSelectionModal } from './ReviewDeck';
import { ISRFile, SrTFile } from './SRFile';
import { TopicPath } from './TopicPath';
import {
	CensorEffectValue,
	censorTextExtension,
	doCensor,
	doUnCensor,
} from './cm-extension/AnswerCensorExtension';
import {
	timerExtension,
	enableTimer,
	timerEffect,
} from './cm-extension/TimerExtension';
import { CardListType } from './enums';
import { FlashcardModal } from './gui/flashcard-modal';
import { FlashcardReviewButton } from './gui/flashcard-review-button';
import { FlashCardReviewPopover } from './gui/flashcard-review-popover';
import { REVIEW_QUEUE_VIEW_TYPE, ReviewQueueListView } from './gui/sidebar';
import { ICON_NAME } from './icon/appicon';
import { bookHeartIcon } from './icon/icons';
import { PluginData, SRSettings } from './interfaces';
import { t } from './lang/helpers';
import { DEFAULT_SETTINGS, SRSettingTab } from './settings';
import { isContainSchedulingExtractor } from './util/utils';
import { FOLLOW_UP_PATH_REGEX } from './constants';

// Remember to rename these classes and interfaces!

const DEFAULT_DATA: PluginData = {
	settings: DEFAULT_SETTINGS,
	buryDate: '',
	buryList: [],
	historyDeck: null,
};

export interface LinkStat {
	sourcePath: string;
	linkCount: number;
}

class StatusBarManager {
	private element: HTMLElement;

	constructor(plugin: Plugin) {
		this.element = plugin.addStatusBarItem();
		this.element.classList.add('mod-clickable');
		this.element.setAttribute('aria-label', t('OPEN_NOTE_FOR_REVIEW'));
		this.element.setAttribute('aria-label-position', 'top');
	}

	setClickHandler(handler: () => void) {
		this.element.addEventListener('click', handler);
	}

	updateText(dueNotesCount: number, dueFlashcardsCount: number) {
		this.element.setText(
			t('STATUS_BAR', {
				dueNotesCount,
				dueFlashcardsCount,
			}),
		);
	}
}

export default class SRPlugin extends Plugin {
	private statusBarManager: StatusBarManager;
	private reviewQueueView: ReviewQueueListView;
	public data: PluginData;
	public syncLock = false;

	public reviewDecks: { [deckKey: string]: ReviewDeck } = {};
	public lastSelectedReviewDeck: string;

	public easeByPath: NoteEaseList;
	private questionPostponementList: QuestionPostponementList;

	public deckTree: Deck = new Deck('root', null);
	private remainingDeckTree: Deck;
	// public cardStats: Stats;
	private reviewSequencer: IFlashcardReviewSequencer;
	public isReviewing = false;

	get editor() {
		return this.app.workspace.activeEditor?.editor as Editor & {
			cm: EditorView;
		};
	}

	async onload(): Promise<void> {
		await this.loadPluginData();
		this.isReviewing = false;
		this.easeByPath = new NoteEaseList(this.data.settings);
		this.questionPostponementList = new QuestionPostponementList(
			this,
			this.data.settings,
			this.data.buryList,
		);

		addIcon(ICON_NAME, bookHeartIcon);

		this.statusBarManager = new StatusBarManager(this);

		this.addRibbonIcon(ICON_NAME, t('REVIEW_CARDS'), async () => {
			if (this.syncLock) {
				return;
			}

			if (this.isReviewing) {
				this.traverseCurrentCard();
				new Notice(`Welcome back to your reviewing!`);
				return;
			}

			await this.sync();

			this.openFlashcardModal(
				this.deckTree,
				this.remainingDeckTree,
				FlashcardReviewMode.Review,
			);
		});

		this.addSettingTab(new SRSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.initView();
			setTimeout(async () => {
				if (!this.syncLock) {
					await this.sync();
				}
			}, 2000);
		});

		this.registerDomEvent(document, 'click', (event) => {
			if (!this.reviewSequencer) return;

			const target = event.target as HTMLElement;

			if (
				isContainSchedulingExtractor(target.textContent || '') &&
				target.classList.contains('cm-comment') &&
				this.reviewSequencer.currentCard?.isDue
			) {
				this.openFlashcardReviewPopover(target);
			}
		});

		// Un-censor the answer.
		this.registerDomEvent(document, 'click', (event) => {
			const target = event.target as HTMLElement;

			if (!target.classList.contains('cm-censored')) {
				return;
			}

			const timerEl = document.querySelector('.cm-timer') as HTMLElement;

			this.removeCensoredMark(target);
			this.removeTimer(timerEl, true);
		});

		this.registerDomEvent(document, 'dblclick', (event) => {
			if (
				this.reviewSequencer &&
				this.reviewSequencer.currentCard?.isNew
			) {
				this.openFlashcardReviewPopover(event.target as HTMLElement);
			}
		});

		this.registerEditorExtension([censorTextExtension, timerExtension]);
	}

	onunload(): void {
		this.app.workspace
			.getLeavesOfType(REVIEW_QUEUE_VIEW_TYPE)
			.forEach((leaf) => leaf.detach());
	}

	savePluginData() {
		//
	}

	/**
	 * Loads the plugin data from the storage and merges it with the default data.
	 */
	private async loadPluginData(): Promise<void> {
		this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
		this.data.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			this.data.settings,
		);
	}

	/**
	 * Synchronizes the plugin data with the current state of the notes and flashcards.
	 * It resets the notes and flashcards data, loads the notes, calculates the pageranks for the notes,
	 * and updates the status bar.
	 */
	private async sync(): Promise<void> {
		if (this.syncLock) {
			return;
		}
		this.syncLock = true;

		// reset notes stuff
		graph.reset();
		this.easeByPath = new NoteEaseList(this.data.settings);
		const incomingLinks: Record<string, LinkStat[]> = {};
		const pageranks: Record<string, number> = {};
		let dueNotesCount = 0;
		const dueDatesNotes: Record<number, number> = {};
		this.reviewDecks = {};

		// reset flashcards stuff
		const fullDeckTree = new Deck('root', null);

		const now = window.moment(Date.now());
		const todayDate: string = now.format('YYYY-MM-DD');
		// clear bury list if we've changed dates
		if (todayDate !== this.data.buryDate) {
			this.data.buryDate = todayDate;
			this.questionPostponementList.clear();

			// The following isn't needed for plug-in functionality; but can aid during debugging
			await this.savePluginData();
		}

		const notes: TFile[] = this.app.vault.getMarkdownFiles();

		for (const noteFile of notes) {
			if (
				this.data.settings.noteFoldersToIgnore.some((folder) =>
					noteFile.path.startsWith(folder),
				)
			) {
				continue;
			}

			if (incomingLinks[noteFile.path] === undefined) {
				incomingLinks[noteFile.path] = [];
			}

			const links =
				this.app.metadataCache.resolvedLinks[noteFile.path] || {};
			for (const targetPath in links) {
				if (incomingLinks[targetPath] === undefined)
					incomingLinks[targetPath] = [];

				// markdown files only
				if (targetPath.split('.').pop()?.toLowerCase() === 'md') {
					incomingLinks[targetPath].push({
						sourcePath: 'noteFile.path',
						linkCount: links[targetPath],
					});

					graph.link(noteFile.path, targetPath, links[targetPath]);
				}
			}

			const topicPath: TopicPath = this.findTopicPath(
				this.createSrTFile(noteFile),
			);
			if (topicPath.hasPath) {
				const note: Note = await this.loadNote(noteFile, topicPath);
				console.log('NOTE', note)
				const flashcardsInNoteAvgEase: number =
					NoteEaseCalculator.Calculate(note, this.data.settings);
				note.appendCardsToDeck(fullDeckTree);

				if (flashcardsInNoteAvgEase > 0) {
					this.easeByPath.setEaseForPath(
						note.filePath as string,
						flashcardsInNoteAvgEase,
					);
				}
			}

			const fileCachedData =
				this.app.metadataCache.getFileCache(noteFile) || {};

			const frontmatter: FrontMatterCache | Record<string, unknown> =
				fileCachedData.frontmatter || {};
			const tags = getAllTags(fileCachedData) || [];

			let shouldIgnore = true;
			const matchedNoteTags = [];

			for (const tagToReview of this.data.settings.tagsToReview) {
				if (
					tags.some(
						(tag) =>
							tag === tagToReview ||
							tag.startsWith(tagToReview + '/'),
					)
				) {
					if (
						!Object.prototype.hasOwnProperty.call(
							this.reviewDecks,
							tagToReview,
						)
					) {
						this.reviewDecks[tagToReview] = new ReviewDeck(
							tagToReview,
						);
					}
					matchedNoteTags.push(tagToReview);
					shouldIgnore = false;
					break;
				}
			}
			if (shouldIgnore) {
				continue;
			}

			// file has no scheduling information
			if (
				!(
					Object.prototype.hasOwnProperty.call(
						frontmatter,
						'sr-due',
					) &&
					Object.prototype.hasOwnProperty.call(
						frontmatter,
						'sr-interval',
					) &&
					Object.prototype.hasOwnProperty.call(frontmatter, 'sr-ease')
				)
			) {
				for (const matchedNoteTag of matchedNoteTags) {
					this.reviewDecks[matchedNoteTag].newNotes.push(noteFile);
				}
				continue;
			}

			const dueUnix: number = window
				.moment(frontmatter['sr-due'], [
					'YYYY-MM-DD',
					'DD-MM-YYYY',
					'ddd MMM DD YYYY',
				])
				.valueOf();

			for (const matchedNoteTag of matchedNoteTags) {
				this.reviewDecks[matchedNoteTag].scheduledNotes.push({
					note: noteFile,
					dueUnix,
				});
				if (dueUnix <= now.valueOf()) {
					this.reviewDecks[matchedNoteTag].dueNotesCount++;
				}
			}

			let ease: number;
			if (this.easeByPath.hasEaseForPath(noteFile.path)) {
				ease =
					(this.easeByPath.getEaseByPath(noteFile.path) +
						frontmatter['sr-ease']) /
					2;
			} else {
				ease = frontmatter['sr-ease'];
			}
			this.easeByPath.setEaseForPath(noteFile.path, ease);

			if (dueUnix <= now.valueOf()) {
				dueNotesCount++;
			}

			const nDays: number = Math.ceil(
				(dueUnix - now.valueOf()) / (24 * 3600 * 1000),
			);
			if (!Object.prototype.hasOwnProperty.call(dueDatesNotes, nDays)) {
				dueDatesNotes[nDays] = 0;
			}
			dueDatesNotes[nDays]++;
		}

		graph.rank(0.85, 0.000001, (node: string, rank: number) => {
			pageranks[node] = rank * 10000;
		});

		// Reviewable cards are all except those with the "edit later" tag
		this.deckTree = DeckTreeFilter.filterForReviewableCards(fullDeckTree);

		// sort the deck names
		this.deckTree.sortSubdecksList();
		this.remainingDeckTree = DeckTreeFilter.filterForRemainingCards(
			this.questionPostponementList,
			this.deckTree,
			FlashcardReviewMode.Review,
		);
		// const calc: DeckTreeStatsCalculator = new DeckTreeStatsCalculator();
		// this.cardStats = calc.calculate(this.deckTree);

		if (this.data.settings.showDebugMessages) {
			console.log(`SR: ${t('EASES')}`, this.easeByPath.dict);
			console.log(`SR: ${t('DECKS')}`, this.deckTree);
		}

		for (const deckKey in this.reviewDecks) {
			this.reviewDecks[deckKey].sortNotes(pageranks);
		}

		if (this.data.settings.showDebugMessages) {
			console.log(
				'SR: ' +
					t('SYNC_TIME_TAKEN', {
						t: Date.now() - now.valueOf(),
					}),
			);
		}

		this.statusBarManager.updateText(
			dueNotesCount,
			this.remainingDeckTree.getCardCount(CardListType.All, true),
		);

		if (this.data.settings.enableNoteReviewPaneOnStartup)
			this.reviewQueueView.redraw();
		this.syncLock = false;
	}

	/**
	 * Opens a modal for reviewing the next note.
	 * If there's only one review deck, it reviews the next note in that deck.
	 * Otherwise, it opens a modal for selecting a deck to review.
	 */
	private reviewNextNoteModal() {
		const reviewDeckNames: string[] = Object.keys(this.reviewDecks);
		if (reviewDeckNames.length === 1) {
			this.reviewNextNote(reviewDeckNames[0]);
		} else {
			const deckSelectionModal = new ReviewDeckSelectionModal(
				this.app,
				reviewDeckNames,
			);
			// deckSelectionModal.submitCallback = (deckKey: string) => this.reviewNextNote(deckKey);
			deckSelectionModal.open();
		}
	}

	async reviewNextNote(deckKey: string): Promise<void> {
		if (!Object.prototype.hasOwnProperty.call(this.reviewDecks, deckKey)) {
			new Notice(t('NO_DECK_EXISTS', { deckName: deckKey }));
			return;
		}

		this.lastSelectedReviewDeck = deckKey;
		const deck = this.reviewDecks[deckKey];

		if (deck.dueNotesCount > 0) {
			const index = this.data.settings.openRandomNote
				? Math.floor(Math.random() * deck.dueNotesCount)
				: 0;
			await this.app.workspace
				.getLeaf()
				.openFile(deck.scheduledNotes[index].note);
			return;
		}

		if (deck.newNotes.length > 0) {
			const index = this.data.settings.openRandomNote
				? Math.floor(Math.random() * deck.newNotes.length)
				: 0;
			this.app.workspace.getLeaf().openFile(deck.newNotes[index]);
			return;
		}

		new Notice(t('ALL_CAUGHT_UP'));
	}

	private openFlashcardReviewPopover(target: HTMLElement) {
		if (!this.reviewSequencer) {
			new Notice('Please start opening deck review first');
			return;
		}

		new FlashCardReviewPopover({
			target,
			settings: this.data.settings,
			reviewSequencer: this.reviewSequencer,
			reviewMode: FlashcardReviewMode.Review,
			app: this.app,
			plugin: this,
			onBack: () => {
				this.openFlashcardModal(
					this.deckTree,
					this.remainingDeckTree,
					FlashcardReviewMode.Review,
				);
				this.isReviewing = false;
			},
			traverseCurrentCard: async () => {
				await this.traverseCurrentCard();
			},
			addFollowUpDeck: (links) => {
				this.addFollowUpDeck(links);
			},
		}).open();
	}

	private removeCensoredMark(censoredEl: HTMLElement | null) {
		if (censoredEl) {
			const effectValueStr = censoredEl.getAttribute('data-effect-value');

			if (!effectValueStr) return;

			const effectValue: CensorEffectValue = JSON.parse(effectValueStr);

			doUnCensor(effectValue.from, effectValue.to, this.editor.cm);
		}
	}

	private removeTimer(timerEl: HTMLElement | null, updateTimerTag = false) {
		if (!timerEl) {
			return;
		}

		const effectValueStr = timerEl.getAttribute('data-effect-value');

		if (!effectValueStr) return;

		const transactions: TransactionSpec[] = [];

		const effectValue = JSON.parse(effectValueStr);
		transactions.push({
			effects: timerEffect.of({
				from: effectValue.from,
				type: 'disable',
			}),
		});

		const timerPos = this.reviewSequencer.currentCard!.getTimerPosition();

		if (updateTimerTag && timerPos.length > 0) {
			const timerLineNo = this.reviewSequencer.currentCard!.timerLineNo();

			transactions.push({
				changes: [
					{
						from: this.editor.posToOffset({
							line: timerLineNo,
							ch: timerPos[0].start,
						}),
						to: this.editor.posToOffset({
							line: timerLineNo,
							ch: timerPos[0].end,
						}),
						insert: `#timer:${timerEl.textContent}`,
					},
				],
			});
		}

		this.editor.cm.dispatch(...transactions);
	}

	async addFollowUpDeck(links: string[]): Promise<void> {
		for (let i = 0; i < links.length; i++) {
			const internalLink = links[i];
			const match = internalLink.match(FOLLOW_UP_PATH_REGEX);
			const followUpNotePath = match ? match[1] : '';
			const followUpNote = this.app.metadataCache.getFirstLinkpathDest(
				followUpNotePath,
				'',
			);

			if (followUpNote) {
				const topicPath = this.findTopicPath(
					this.createSrTFile(followUpNote),
				);
				const newDeck = new Deck(`follow-up-${i}`, null);
				const note = await this.loadNote(followUpNote, topicPath);

				newDeck.addCards(note.getAllCards());

				this.reviewSequencer.deckTreeIterator.addFollowUpDeck(
					newDeck,
					topicPath,
				);
			}
		}
	}

	/**
	 * Navigates to the current card in the review sequence.
	 * This function opens the note associated with the current card and scrolls to the position of the card in the note.
	 */
	private async traverseCurrentCard() {
		if (!this.reviewSequencer.currentNote) return;
		this.isReviewing = true;

		const leaves = this.app.workspace.getLeavesOfType('markdown');

		const openingLeaf = leaves.find((leaf) => {
			const view = leaf.view as View & { file: TFile };
			const file = view.file;

			return (
				file &&
				file.path === this.reviewSequencer.currentNote!.file.path
			);
		});

		if (openingLeaf) {
			this.app.workspace.setActiveLeaf(openingLeaf);
		} else {
			await this.app.workspace.openLinkText(
				this.reviewSequencer.currentNote.file.basename,
				this.reviewSequencer.currentNote.file.path as string,
			);
		}

		const censoredEl = document.querySelector(
			'.cm-censored',
		) as HTMLElement;
		const timerEl = document.querySelector('.cm-timer') as HTMLElement;

		this.removeCensoredMark(censoredEl);
		this.removeTimer(timerEl);

		const { front, back, question } = this.reviewSequencer.currentCard!;

		// Set selection for front card
		const frontLineNo = this.reviewSequencer.currentCard!.frontLineNo();
		const backLineNo = this.reviewSequencer.currentCard!.backLineNo();

		if (this.reviewSequencer.currentCard!.hasTimer()) {
			enableTimer(
				this.editor.posToOffset({
					line: frontLineNo,
					ch: 0,
				}),
				this.editor.cm,
			);
		}

		if (question.isSingleLineQuestion) {
			const frontStartCh = this.editor
				.getLine(question.lineNoModified)
				.trim()
				.indexOf(front);
			const backStartCh = this.editor
				.getLine(question.lineNoModified)
				.trim()
				.indexOf(back);

			this.editor.setSelection(
				{
					line: frontLineNo,
					ch: frontStartCh,
				},
				{
					line: frontLineNo,
					ch: frontStartCh + front.length,
				},
			);

			if (!this.reviewSequencer.currentCard!.backContainsLinkOnly()) {
				doCensor(
					this.editor.posToOffset({
						line: backLineNo,
						ch: backStartCh,
					}),
					this.editor.posToOffset({
						line: backLineNo,
						ch: backStartCh + back.length,
					}),
					this.editor.cm,
				);
			}
		} else {
			const lastFrontLineValue = front.split('\n').slice(-1)[0];
			this.editor.setSelection(
				{
					line: frontLineNo,
					ch: 0,
				},
				{
					line:
						frontLineNo +
						this.reviewSequencer.currentCard!.numberOfLinesFront() -
						1,
					ch: lastFrontLineValue.length,
				},
			);

			if (!this.reviewSequencer.currentCard!.backContainsLinkOnly()) {
				const lastBackLineValue = back.split('\n').slice(-1)[0];
				const numberOfLinesBack =
					this.reviewSequencer.currentCard!.numberOfLinesBack();
				doCensor(
					this.editor.posToOffset({ line: backLineNo, ch: 0 }),
					this.editor.posToOffset({
						line: backLineNo + numberOfLinesBack - 1,
						ch: lastBackLineValue.length,
					}),
					this.editor.cm,
				);
			}
		}

		const selection = document.getSelection() as Selection;
		const element = selection.focusNode!.parentElement?.closest('.cm-line');

		if (element) element.scrollIntoView({ block: 'center' });
	}

	/**
	 * Render a tippy popover at left-top of the block of current card.
	 */
	private renderReviewButton() {
		// const editor = this.app.workspace.activeEditor?.editor as Editor;
		// editor.
		const selection = document.getSelection();
		if (!selection) return;

		const element = selection.focusNode!.parentElement?.closest('.cm-line');

		if (!element) return;

		new FlashcardReviewButton({
			onClick: (event) => {
				this.openFlashcardReviewPopover(
					event.currentTarget as HTMLElement,
				);
			},
		}).render(element as HTMLElement);
	}

	/**
	 * Opens a modal for reviewing flashcards.
	 * It sets up a review sequencer and opens a flashcard modal with it.
	 */
	private openFlashcardModal(
		fullDeckTree: Deck,
		remainingDeckTree: Deck,
		reviewMode: FlashcardReviewMode,
	): void {
		const deckIterator = SRPlugin.createDeckTreeIterator(
			this.data.settings,
		);
		const cardScheduleCalculator = new CardScheduleCalculator(
			this.data.settings,
			this.easeByPath,
		);
		this.reviewSequencer = new FlashcardReviewSequencer(
			reviewMode,
			deckIterator,
			this.data.settings,
			cardScheduleCalculator,
			this.questionPostponementList,
		);

		this.reviewSequencer.setDeckTree(fullDeckTree, remainingDeckTree);

		const flashcardModal = new FlashcardModal({
			app: this.app,
			plugin: this,
			settings: this.data.settings,
			reviewSequencer: this.reviewSequencer,
			reviewMode,
			onTraverseCurrentCard: async () => {
				await this.traverseCurrentCard();
			},
		});

		flashcardModal.open();
	}

	/**
	 * Creates an iterator for traversing the deck tree.
	 * The order of traversal is determined by the plugin settings.
	 */
	private static createDeckTreeIterator(
		settings: SRSettings,
	): IDeckTreeIterator {
		const iteratorOrder: IIteratorOrder = {
			deckOrder: OrderMethod.Sequential,
			cardListOrder: CardListOrder.DueFirst,
			cardOrder: settings.randomizeCardOrder
				? OrderMethod.Random
				: OrderMethod.Sequential,
		};
		return new DeckTreeIterator(
			iteratorOrder,
			IteratorDeckSource.UpdatedByIterator,
		);
	}

	/**
	 * Finds the topic path of a note file.
	 */
	private findTopicPath(note: ISRFile): TopicPath {
		return TopicPath.getTopicPathOfFile(note, this.data.settings);
	}

	/**
	 * Creates an SrTFile instance from a TFile instance.
	 */
	private createSrTFile(note: TFile): SrTFile {
		return new SrTFile(this.app.vault, this.app.metadataCache, note);
	}

	/**
	 * Loads a note from a note file and its topic path.
	 * If the note has changed, it writes the note file.
	 */
	private async loadNote(
		noteFile: TFile,
		topicPath: TopicPath,
	): Promise<Note> {
		const loader: NoteFileLoader = new NoteFileLoader(this.data.settings);
		const note: Note = await loader.load(
			this.createSrTFile(noteFile),
			topicPath,
		);
		if (note.hasChanged) note.writeNoteFile(this.data.settings);
		return note;
	}

	/**
	 * Initializes the view of the plugin.
	 * It registers a view for the review queue and opens it if the corresponding setting is enabled.
	 */
	private initView(): void {
		this.registerView(
			REVIEW_QUEUE_VIEW_TYPE,
			(leaf) =>
				(this.reviewQueueView = new ReviewQueueListView(leaf, this)),
		);

		if (
			this.data.settings.enableNoteReviewPaneOnStartup &&
			this.app.workspace.getLeavesOfType(REVIEW_QUEUE_VIEW_TYPE).length ==
				0
		) {
			this.app.workspace.getRightLeaf(false).setViewState({
				type: REVIEW_QUEUE_VIEW_TYPE,
				active: true,
			});
		}
	}

	getTextNodes(el: Node): Text[] {
		const textNodes = [];
		const walker = document.createTreeWalker(
			el,
			NodeFilter.SHOW_TEXT,
			null,
		);
		let node;
		while ((node = walker.nextNode())) {
			textNodes.push(node as Text);
		}
		return textNodes;
	}
}
