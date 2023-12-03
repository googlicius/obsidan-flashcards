/* eslint-disable @typescript-eslint/no-explicit-any */
import { ISRFile, UnitTestSRFile } from 'src/SRFile';
import { TopicPath } from 'src/TopicPath';
import { DEFAULT_SETTINGS } from 'src/settings';
import { SRSettings } from './interfaces';

describe('Constructor exception handling', () => {
	test('Constructor rejects null path', () => {
		const t = () => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const path: TopicPath = new TopicPath(null as any);
		};
		expect(t).toThrow();
	});

	test('Constructor allows zero length array', () => {
		const path: TopicPath = new TopicPath([]);
		expect(path.hasPath).toEqual(false);
	});

	test("Constructor rejects path that includes '/'", () => {
		const t = () => {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const path: TopicPath = new TopicPath(['Hello/Goodbye']);
		};
		expect(t).toThrow();
	});
});

describe('shift', () => {
	test('shift() on multi-part path', () => {
		const path: TopicPath = new TopicPath(['Level1', 'Level2', 'Level3']);
		const result = path.shift();

		expect(result).toEqual('Level1');
		expect(path).toEqual(new TopicPath(['Level2', 'Level3']));
	});

	test('shift() on single-part path', () => {
		const path: TopicPath = new TopicPath(['Level1']);
		const result = path.shift();

		expect(result).toEqual('Level1');
		expect(path.hasPath).toEqual(false);
	});

	test('shift() on empty path', () => {
		const path: TopicPath = new TopicPath([]);

		const t = () => {
			path.shift();
		};
		expect(t).toThrow("can't shift an empty path");
	});
});

describe('getTopicPathFromCardText', () => {
	test("Card text doesn't include tag", () => {
		const cardText = "Card text doesn't include tag";
		const path = TopicPath.getTopicPathFromCardText(cardText);

		expect(path).toEqual(null);
	});

	test('Card text includes single level tag', () => {
		const cardText = '#flashcards Card text does include tag';
		const path = TopicPath.getTopicPathFromCardText(cardText);

		expect(path).toEqual(new TopicPath(['flashcards']));
	});

	test('Card text includes multi level tag', () => {
		let cardText =
			'#flashcards/science/chemistry Card text does include tag';
		let path = TopicPath.getTopicPathFromCardText(cardText);

		expect(path).toEqual(
			new TopicPath(['flashcards', 'science', 'chemistry']),
		);

		cardText = '#flashcards/examination Q2::A2';
		path = TopicPath.getTopicPathFromCardText(cardText);

		expect(path).toEqual(new TopicPath(['flashcards', 'examination']));
	});

	test('Card text includes 2 multi level tags', () => {
		const cardText =
			'#flashcards/science/chemistry Card text includes multiple tag #flashcards/test/chemistry';
		const path = TopicPath.getTopicPathFromCardText(cardText);

		expect(path).toEqual(
			new TopicPath(['flashcards', 'science', 'chemistry']),
		);
	});
});

describe('removeTopicPathFromCardText', () => {
	test("Card text doesn't include tag", () => {
		const cardText = "Card text doesn't include tag";
		const expectedCardText: string = cardText;
		const [actualQuestion, whiteSpace] =
			TopicPath.removeTopicPathFromStartOfCardText(cardText);

		expect(actualQuestion).toEqual(expectedCardText);
		expect(whiteSpace).toEqual('');
	});

	test('Card text includes single level tag', () => {
		const cardText = '#flashcards Card text does include tag';
		const [actualQuestion, whiteSpace] =
			TopicPath.removeTopicPathFromStartOfCardText(cardText);

		expect(actualQuestion).toEqual('Card text does include tag');
		expect(whiteSpace).toEqual(' ');
	});

	test('Card text includes multi level tag', () => {
		const cardText =
			'#flashcards/science/chemistry Card text does include tag';
		const [actualQuestion, whiteSpace] =
			TopicPath.removeTopicPathFromStartOfCardText(cardText);

		expect(actualQuestion).toEqual('Card text does include tag');
		expect(whiteSpace).toEqual(' ');
	});

	test('White space present before topic tag', () => {
		const cardText =
			'   #flashcards/science/chemistry Card text does include tag';
		const [actualQuestion, whiteSpace] =
			TopicPath.removeTopicPathFromStartOfCardText(cardText);

		expect(actualQuestion).toEqual('Card text does include tag');
		expect(whiteSpace).toEqual(' ');
	});

	test('Multiple spaces after topic tag', () => {
		const spaces = '    ';
		const cardText = `#flashcards/science/chemistry${spaces}Card text does include tag`;
		const [actualQuestion, whiteSpace] =
			TopicPath.removeTopicPathFromStartOfCardText(cardText);

		expect(actualQuestion).toEqual('Card text does include tag');
		expect(whiteSpace).toEqual(spaces);
	});
});

describe('getTopicPathFromTag', () => {
	test('Null string', () => {
		const t = () => {
			TopicPath.getTopicPathFromTag(null);
		};
		expect(t).toThrow();
	});

	test('Empty string', () => {
		const t = () => {
			TopicPath.getTopicPathFromTag('');
		};
		expect(t).toThrow();
	});

	test("String that doesn't start with a #", () => {
		const t = () => {
			TopicPath.getTopicPathFromTag('Invalid tag');
		};
		expect(t).toThrow();
	});

	test('String that is only the #', () => {
		const t = () => {
			TopicPath.getTopicPathFromTag('#');
		};
		expect(t).toThrow();
	});

	test('Single level tag', () => {
		const result: TopicPath = TopicPath.getTopicPathFromTag('#flashcard');

		expect(result.path).toEqual(['flashcard']);
	});

	test('Multi level tag', () => {
		const result: TopicPath = TopicPath.getTopicPathFromTag(
			'#flashcard/science/physics',
		);

		expect(result.path).toEqual(['flashcard', 'science', 'physics']);
	});

	test('Tag with trailing slash', () => {
		const result: TopicPath = TopicPath.getTopicPathFromTag(
			'#flashcard/science/physics/',
		);

		expect(result.path).toEqual(['flashcard', 'science', 'physics']);
	});

	test('Tag with multiple adjacent slashes', () => {
		const result: TopicPath = TopicPath.getTopicPathFromTag(
			'#flashcard///science//physics',
		);

		expect(result.path).toEqual(['flashcard', 'science', 'physics']);
	});
});

describe('isSameOrAncestorOf', () => {
	test('a, b are both empty', () => {
		const a: TopicPath = TopicPath.emptyPath;
		const b: TopicPath = TopicPath.emptyPath;
		expect(a.isSameOrAncestorOf(b)).toEqual(true);
	});

	test('a is empty, b has path', () => {
		const a: TopicPath = TopicPath.emptyPath;
		const b: TopicPath = new TopicPath(['flashcard']);
		expect(a.isSameOrAncestorOf(b)).toEqual(false);
	});

	test('a has path, b is empty', () => {
		const a: TopicPath = new TopicPath(['flashcard']);
		const b: TopicPath = TopicPath.emptyPath;
		expect(a.isSameOrAncestorOf(b)).toEqual(false);
	});

	describe('a, b both have paths', () => {
		test('a same as b', () => {
			let a: TopicPath = new TopicPath(['flashcard']);
			let b: TopicPath = new TopicPath(['flashcard']);
			expect(a.isSameOrAncestorOf(b)).toEqual(true);

			a = new TopicPath(['flashcard', 'science']);
			b = new TopicPath(['flashcard', 'science']);
			expect(a.isSameOrAncestorOf(b)).toEqual(true);
		});

		test('a is ancestor of b', () => {
			let a: TopicPath = new TopicPath(['flashcard']);
			let b: TopicPath = new TopicPath(['flashcard', 'science']);
			expect(a.isSameOrAncestorOf(b)).toEqual(true);

			a = new TopicPath(['flashcard']);
			b = new TopicPath(['flashcard', 'science', 'physics']);
			expect(a.isSameOrAncestorOf(b)).toEqual(true);
		});

		test('a is different to b', () => {
			let a: TopicPath = new TopicPath(['flashcard', 'math']);
			let b: TopicPath = new TopicPath(['flashcard', 'science']);
			expect(a.isSameOrAncestorOf(b)).toEqual(false);

			a = new TopicPath(['flashcard', 'science', 'physics']);
			b = new TopicPath(['flashcard', 'science', 'chemistry']);
			expect(a.isSameOrAncestorOf(b)).toEqual(false);
		});
	});
});

describe('clone', () => {
	test('clone of empty', () => {
		const a: TopicPath = TopicPath.emptyPath;
		const b: TopicPath = a.clone();
		expect(b.isEmptyPath).toEqual(true);
	});

	test('clone of path', () => {
		let a: TopicPath = new TopicPath(['flashcard']);
		let b: TopicPath = a.clone();
		expect(b.path).toEqual(['flashcard']);

		a = new TopicPath(['flashcard', 'science']);
		b = a.clone();
		expect(b.path).toEqual(['flashcard', 'science']);
	});
});

describe('formatTag', () => {
	test('Simple test', () => {
		const topicPath: TopicPath = new TopicPath(['flashcards', 'science']);

		expect(topicPath.formatAsTag()).toEqual('#flashcards/science');
	});

	test('Empty path', () => {
		const t = () => {
			TopicPath.emptyPath.formatAsTag();
		};
		expect(t).toThrow();
	});
});

describe('isValidTag', () => {
	test('Invalid tags', () => {
		expect(TopicPath.isValidTag(null)).toEqual(false);
		expect(TopicPath.isValidTag('')).toEqual(false);
		expect(TopicPath.isValidTag('!Flashcards')).toEqual(false);
		expect(TopicPath.isValidTag('#')).toEqual(false);
	});

	test('Valid tags', () => {
		expect(TopicPath.isValidTag('#flashcards')).toEqual(true);
	});
});

describe('getTopicPathOfFile', () => {
	describe('convertFoldersToDecks: false', () => {
		test('Mixture of irrelevant tags and relevant ones', () => {
			const content = `
            #ignored Q1::A1
            #ignored Q2::A2 <!--SR:!2023-09-02,4,270-->
            #also-Ignored Q3::A3
            #flashcards/science Q4::A4 <!--SR:!2023-09-02,4,270-->
            #flashcards/science/physics Q5::A5 <!--SR:!2023-09-02,4,270-->
            #flashcards/math Q6::A6`;
			const file: ISRFile = new UnitTestSRFile(content);
			const expected = ['flashcards', 'science'];

			expect(
				TopicPath.getTopicPathOfFile(file, DEFAULT_SETTINGS).path,
			).toEqual(expected);
		});

		test('No relevant tags', () => {
			const content = `
            #ignored Q1::A1
            #ignored Q2::A2 <!--SR:!2023-09-02,4,270-->
            #also-Ignored Q3::A3
            Q4::A4 <!--SR:!2023-09-02,4,270-->
            #ignored/science/physics Q5::A5 <!--SR:!2023-09-02,4,270-->
            Q6::A6`;
			const file: ISRFile = new UnitTestSRFile(content);

			expect(
				TopicPath.getTopicPathOfFile(file, DEFAULT_SETTINGS)
					.isEmptyPath,
			).toEqual(true);
		});
	});

	describe('convertFoldersToDecks: true', () => {
		const settings_ConvertFoldersToDecks: SRSettings = {
			...DEFAULT_SETTINGS,
		};
		settings_ConvertFoldersToDecks.convertFoldersToDecks = true;
		test('Mixture of irrelevant tags and relevant ones', () => {
			const ignoredContent = `
            #ignored Q1::A1
            #ignored Q2::A2 <!--SR:!2023-09-02,4,270-->
            #also-Ignored Q3::A3
            #flashcards/science Q4::A4 <!--SR:!2023-09-02,4,270-->
            #flashcards/science/physics Q5::A5 <!--SR:!2023-09-02,4,270-->
            #flashcards/math Q6::A6`;

			const fakeFilePath = 'history/modern/Greek.md';
			const file: ISRFile = new UnitTestSRFile(
				ignoredContent,
				fakeFilePath,
			);
			const expected = ['history', 'modern'];
			const actual = TopicPath.getTopicPathOfFile(
				file,
				settings_ConvertFoldersToDecks,
			);
			expect(actual.path).toEqual(expected);
		});
	});
});
